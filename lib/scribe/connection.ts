import {
  FatalError,
  RetryableError,
  classifyServerError,
  isErrorMessage,
  type ServerMessage,
} from "@/lib/scribe/protocol";

export const SAMPLE_RATE = 16000;

/** Base do WebSocket. Só se altera em testes (servidor simulado). */
const WS_BASE = process.env.NEXT_PUBLIC_SCRIBE_WS_BASE ?? "wss://api.elevenlabs.io";

export interface ConnectionParams {
  token: string;
  modelId: string;
  language: string;
  keyterms: string[];
  vadSilenceSecs: number;
  filterBackground: boolean;
}

/** Monta o URL do WebSocket com os parâmetros documentados na referência da API. */
export function buildScribeUrl(p: ConnectionParams): string {
  const url = new URL("/v1/speech-to-text/realtime", WS_BASE);
  const q = url.searchParams;
  q.set("model_id", p.modelId);
  q.set("token", p.token);
  q.set("audio_format", "pcm_16000");
  q.set("commit_strategy", "vad");
  q.set("vad_silence_threshold_secs", String(p.vadSilenceSecs));
  q.set("include_timestamps", "true");
  if (p.language) q.set("language_code", p.language);
  if (p.filterBackground) q.set("filter_background_audio", "true");
  for (const term of p.keyterms) q.append("keyterms", term);
  return url.toString();
}

function toBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export interface ConnectionHandlers {
  onMessage: (m: ServerMessage) => void;
  onClose: (code: number, reason: string) => void;
}

/** Uma ligação WebSocket ao Scribe Realtime. */
export class ScribeConnection {
  ready = false;
  closed = false;
  openedAt = 0;
  /** Instante (em segundos na linha temporal da sessão) do primeiro áudio enviado nesta ligação. */
  offsetSec: number | null = null;

  private ws: WebSocket | null = null;

  constructor(
    private url: string,
    private handlers: ConnectionHandlers,
  ) {}

  /** Abre a ligação e resolve quando o servidor responde com `session_started`. */
  connect(timeoutMs = 12000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => {
          this.close();
          reject(new RetryableError("A ligação à ElevenLabs demorou demasiado."));
        });
      }, timeoutMs);

      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch {
        finish(() => reject(new RetryableError("Não foi possível abrir a ligação.")));
        return;
      }
      this.ws = ws;

      ws.onmessage = (event) => {
        let m: ServerMessage;
        try {
          m = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (!this.ready) {
          if (m.message_type === "session_started") {
            this.ready = true;
            this.openedAt = Date.now();
            finish(() => resolve(m));
            return;
          }
          if (isErrorMessage(m.message_type)) {
            const verdict = classifyServerError(m);
            finish(() => {
              this.close();
              reject(
                verdict.fatal
                  ? new FatalError(verdict.message)
                  : new RetryableError(verdict.message),
              );
            });
          }
          return;
        }
        this.handlers.onMessage(m);
      };

      ws.onerror = () => {
        finish(() => reject(new RetryableError("Não foi possível ligar à ElevenLabs.")));
      };

      ws.onclose = (event) => {
        this.closed = true;
        const wasReady = this.ready;
        this.ready = false;
        finish(() => reject(new RetryableError("A ligação à ElevenLabs foi fechada.")));
        if (wasReady) this.handlers.onClose(event.code, event.reason);
      };
    });
  }

  /** Envia um bloco de áudio PCM 16 kHz. `previousText` só vale no primeiro bloco da ligação. */
  sendAudio(pcm: Int16Array, previousText?: string): void {
    if (!this.ws || !this.ready) return;
    const msg: Record<string, unknown> = {
      message_type: "input_audio_chunk",
      audio_base_64: toBase64(pcm),
      commit: false,
      sample_rate: SAMPLE_RATE,
    };
    if (previousText) msg.previous_text = previousText;
    this.ws.send(JSON.stringify(msg));
  }

  /** Pede ao servidor para fechar o segmento atual (usado ao parar). */
  sendCommit(): void {
    if (!this.ws || !this.ready) return;
    this.ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: "",
        commit: true,
        sample_rate: SAMPLE_RATE,
      }),
    );
  }

  close(): void {
    this.ready = false;
    this.closed = true;
    const ws = this.ws;
    if (!ws) return;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      // já fechada
    }
  }
}
