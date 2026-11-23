/**
 * Captura do microfone em PCM 16-bit, 16 kHz, mono (formato pcm_16000 do Scribe).
 *
 * Um AudioWorklet faz a reamostragem (o browser capta a 44,1 ou 48 kHz) e envia
 * blocos de ~128 ms, mais o nível do sinal para o indicador do microfone.
 *
 * Desativamos o cancelamento de eco e a supressão de ruído de propósito: se a
 * audição estiver a tocar nas colunas do mesmo computador, o cancelamento de
 * eco "apagaria" precisamente o áudio que queremos transcrever.
 */

const WORKLET_SOURCE = `
class Pcm16kProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.sum = 0; this.count = 0; this.phase = 0;
    this.out = new Int16Array(2048); this.n = 0;
    this.sq = 0; this.frames = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      this.sq += s * s; this.frames++;
      this.sum += s; this.count++; this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        let v = this.sum / this.count; this.sum = 0; this.count = 0;
        v = v < -1 ? -1 : v > 1 ? 1 : v;
        this.out[this.n++] = v < 0 ? v * 32768 : v * 32767;
        if (this.n === this.out.length) {
          this.port.postMessage({ pcm: this.out.buffer }, [this.out.buffer]);
          this.out = new Int16Array(2048); this.n = 0;
        }
      }
    }
    if (this.frames >= 2048) {
      this.port.postMessage({ level: Math.sqrt(this.sq / this.frames) });
      this.sq = 0; this.frames = 0;
    }
    return true;
  }
}
registerProcessor("pcm16k", Pcm16kProcessor);
`;

export interface MicHandlers {
  onChunk: (pcm: Int16Array) => void;
  /** Nível normalizado 0..1 (escala em dB). */
  onLevel: (level: number) => void;
  /** O microfone foi desligado (ex.: retirado da ficha). */
  onEnded: () => void;
}

/** Converte RMS (0..1) numa escala 0..1 entre -60 dB e -10 dB. */
function rmsToLevel(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 60) / 50));
}

export class MicCapture {
  private constructor(
    readonly stream: MediaStream,
    private ctx: AudioContext,
    private nodes: AudioNode[],
  ) {}

  static async start(h: MicHandlers): Promise<MicCapture> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicError("insecure");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      },
    });

    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext({ latencyHint: "interactive" });
      await ctx.resume();

      const url = URL.createObjectURL(
        new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
      );
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }

      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, "pcm16k", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      // O worklet só é processado se estiver ligado ao destino; usamos um ganho 0
      // para não ouvirmos o microfone nas colunas.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(worklet);
      worklet.connect(mute);
      mute.connect(ctx.destination);

      worklet.port.onmessage = (event: MessageEvent) => {
        const data = event.data as { pcm?: ArrayBuffer; level?: number };
        if (data.pcm) h.onChunk(new Int16Array(data.pcm));
        else if (typeof data.level === "number") h.onLevel(rmsToLevel(data.level));
      };

      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", () => h.onEnded());
      }

      return new MicCapture(stream, ctx, [source, worklet, mute]);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      throw err;
    }
  }

  stop(): void {
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // já desligado
      }
    }
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close();
  }
}

export class MicError extends Error {
  constructor(readonly kind: "insecure") {
    super(kind);
  }
}

/** Mensagem em português para um erro ao abrir o microfone. */
export function micErrorMessage(err: unknown): string {
  if (err instanceof MicError) {
    return "O microfone só funciona em ligações seguras (HTTPS). Abre a app pelo endereço https.";
  }
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "O browser bloqueou o microfone. Permite o acesso nas definições do site e tenta de novo.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Não foi encontrado nenhum microfone neste dispositivo.";
    case "NotSupportedError":
      return "Este browser não permite usar o microfone aqui. Experimenta o Chrome ou o Safari atualizados, por HTTPS.";
    case "NotReadableError":
    case "AbortError":
      return "Não foi possível usar o microfone. Pode estar a ser usado por outra aplicação.";
    default:
      return "Não foi possível abrir o microfone.";
  }
}
