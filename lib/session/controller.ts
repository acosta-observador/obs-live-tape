import { MicCapture, micErrorMessage } from "@/lib/audio/mic";
import {
  SAMPLE_RATE,
  ScribeConnection,
  buildScribeUrl,
} from "@/lib/scribe/connection";
import {
  FatalError,
  classifyServerError,
  isErrorMessage,
  type ScribeWord,
  type ServerMessage,
} from "@/lib/scribe/protocol";
import { fetchToken } from "@/lib/scribe/token";
import { parseVocabulary, type Settings } from "@/lib/settings";

export type SessionStatus =
  | "idle"
  | "connecting"
  | "recording"
  | "reconnecting"
  | "stopping"
  | "error";

export interface Segment {
  id: string;
  /** "speech" = texto transcrito; "gap" = intervalo em que a ligação falhou. */
  kind: "speech" | "gap";
  text: string;
  /** Segundos desde o início da sessão. */
  startSec: number;
  endSec?: number;
  /** Texto ainda não confirmado pelo servidor (a ligação caiu antes da confirmação). */
  provisional?: boolean;
  /** Só em "gap": parte do áudio ficou sem transcrição. */
  lost?: boolean;
}

export interface SessionSnapshot {
  status: SessionStatus;
  segments: Segment[];
  /** Texto parcial (ainda não confirmado) do segmento em curso. */
  partial: string;
  error: string | null;
  reconnectAttempt: number;
}

interface Chunk {
  pcm: Int16Array;
  /** Posição (em amostras) deste bloco desde o início da execução atual. */
  startSample: number;
}

interface TimestampEntry {
  text: string;
  words: ScribeWord[];
  offsetSec: number;
  timer?: ReturnType<typeof setTimeout>;
}

const INITIAL: SessionSnapshot = {
  status: "idle",
  segments: [],
  partial: "",
  error: null,
  reconnectAttempt: 0,
};

/** Áudio guardado em memória enquanto não há ligação (90 s). Acima disto, perde-se o mais antigo. */
const MAX_QUEUE_SECONDS = 90;
/** Velocidade a que se escoa o áudio em fila após reconectar (x tempo real). */
const DRAIN_SPEED = 3;
/** Espera pelo evento com timestamps depois do texto confirmado. */
const TIMESTAMP_PAIR_MS = 500;
/** Tolerância entre os timestamps do servidor e a nossa estimativa. */
const TIMESTAMP_SANITY_SEC = 30;

let idSeq = 0;
const nextId = () => `seg-${++idSeq}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const similar = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x === y || x.startsWith(y) || y.startsWith(x);
};

/**
 * Controla uma sessão de transcrição: microfone -> WebSocket -> segmentos.
 *
 * Linha temporal: os timestamps contam o tempo de áudio gravado desde o início
 * da sessão. Se o jornalista parar e voltar a iniciar, a contagem continua
 * (coincide com o áudio descarregado no fim).
 */
export class LiveSessionController {
  private snap: SessionSnapshot = INITIAL;
  private listeners = new Set<() => void>();
  private levelListeners = new Set<(level: number) => void>();
  private rawListener: ((kind: string, data?: unknown) => void) | null = null;

  private settings!: Settings;
  private mic: MicCapture | null = null;
  private conn: ScribeConnection | null = null;
  private wakeLock: WakeLockSentinel | null = null;

  // linha temporal
  private timelineSec = 0; // total gravado em execuções anteriores
  private runBaseSec = 0; // timelineSec no início desta execução
  private captured = 0; // amostras captadas nesta execução
  private lastSentSample = 0;

  // fila de áudio
  private queue: Chunk[] = [];
  private queuedSamples = 0;
  private droppedSamples = 0;
  private pumping = false;

  // controlo do ciclo de vida
  private runId = 0;
  private stopRequested = false;
  private loopRun = -1;
  private everConnected = false;
  private failStreak = 0;
  private authFailures = 0;
  private lostFromSec: number | null = null;
  private pendingPreviousText: string | undefined;
  private commitWaiter: (() => void) | null = null;

  // montagem de segmentos
  private partialStartSec: number | null = null;
  private unpaired: string[] = [];
  private pendingTs: TimestampEntry[] = [];

  // ---- API para a interface -------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): SessionSnapshot => this.snap;
  getServerSnapshot = (): SessionSnapshot => INITIAL;

  subscribeLevel(listener: (level: number) => void): () => void {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  /** Só usado na página de diagnóstico. */
  setRawListener(fn: ((kind: string, data?: unknown) => void) | null): void {
    this.rawListener = fn;
  }

  /** Segundos de sessão neste momento (inclui execuções anteriores). */
  elapsedSec(): number {
    const running = this.snap.status !== "idle" && this.snap.status !== "error";
    return running ? this.clockSec() : this.timelineSec;
  }

  async start(settings: Settings): Promise<void> {
    if (this.snap.status !== "idle" && this.snap.status !== "error") return;
    this.settings = settings;
    this.stopRequested = false;
    this.runId++;
    const run = this.runId;
    this.captured = 0;
    this.lastSentSample = 0;
    this.queue = [];
    this.queuedSamples = 0;
    this.droppedSamples = 0;
    this.pumping = false;
    this.everConnected = false;
    this.failStreak = 0;
    this.authFailures = 0;
    this.lostFromSec = null;
    this.runBaseSec = this.timelineSec;
    this.partialStartSec = null;
    this.unpaired = [];
    this.pendingTs = [];
    this.pendingPreviousText = settings.context.trim().slice(0, 50) || undefined;
    this.set({ status: "connecting", error: null, partial: "", reconnectAttempt: 0 });

    try {
      this.mic = await MicCapture.start({
        onChunk: (pcm) => this.onChunk(pcm),
        onLevel: (level) => this.levelListeners.forEach((l) => l(level)),
        onEnded: () => this.fail("O microfone foi desligado. Liga-o e carrega em Iniciar para continuar."),
      });
    } catch (err) {
      this.fail(micErrorMessage(err));
      return;
    }
    if (this.stopRequested || run !== this.runId) {
      this.mic?.stop();
      this.mic = null;
      return;
    }
    void this.acquireWakeLock();
    document.addEventListener("visibilitychange", this.onVisibility);
    void this.connectLoop(run, false);
  }

  /** Para a captação, fecha o último segmento e termina a ligação. */
  async stop(): Promise<void> {
    const status = this.snap.status;
    if (status === "idle" || status === "stopping" || status === "error") return;
    this.stopRequested = true;
    this.set({ status: "stopping" });
    this.mic?.stop();
    this.mic = null;

    const conn = this.conn;
    if (conn?.ready) {
      while (this.queue.length) {
        const c = this.queue.shift()!;
        this.queuedSamples -= c.pcm.length;
        this.sendChunk(conn, c);
      }
      if (this.snap.partial.trim()) {
        conn.sendCommit();
        await this.waitForCommit(3000);
        await sleep(TIMESTAMP_PAIR_MS + 150);
      }
    }
    this.finishRun();
    this.set({ status: "idle", reconnectAttempt: 0 });
  }

  /** Apaga a transcrição e reinicia a linha temporal. Só com a sessão parada. */
  reset(): void {
    if (this.snap.status !== "idle" && this.snap.status !== "error") return;
    this.timelineSec = 0;
    this.unpaired = [];
    this.pendingTs.forEach((e) => e.timer && clearTimeout(e.timer));
    this.pendingTs = [];
    this.snap = { ...INITIAL };
    this.emit();
  }

  /** Chamado quando o ecrã desaparece. */
  dispose(): void {
    if (this.snap.status !== "idle" && this.snap.status !== "error") {
      this.stopRequested = true;
      this.finishRun();
    }
  }

  // ---- ligação --------------------------------------------------------------

  private async connectLoop(run: number, delayFirst: boolean): Promise<void> {
    // Um só ciclo de ligação por execução (o runId muda sempre que se para/inicia).
    if (this.loopRun === run) return;
    this.loopRun = run;
    let attempt = 0;
    try {
      if (delayFirst) await this.backoff(run);
      while (!this.stopRequested && run === this.runId) {
        attempt++;
        this.set({
          status: this.everConnected ? "reconnecting" : "connecting",
          reconnectAttempt: this.everConnected || attempt > 1 ? attempt : 0,
        });
        try {
          const token = await fetchToken();
          if (this.stopRequested || run !== this.runId) return;
          this.raw("token:ok");

          const conn = new ScribeConnection(
            buildScribeUrl({
              token,
              modelId: this.settings.modelId,
              language: this.settings.language,
              keyterms: parseVocabulary(this.settings.vocabulary),
              vadSilenceSecs: this.settings.vadSilenceSecs,
              filterBackground: this.settings.filterBackground,
            }),
            {
              onMessage: (m) => this.onMessage(conn, m),
              onClose: (code, reason) => this.onClose(conn, code, reason),
            },
          );
          const started = await conn.connect();
          this.raw("ws:session_started", started);
          if (this.stopRequested || run !== this.runId) {
            conn.close();
            return;
          }
          this.attach(conn);
          return;
        } catch (err) {
          if (err instanceof FatalError) {
            this.fail(err.message);
            return;
          }
          this.raw("connect:retry", (err as Error).message);
          this.failStreak++;
          if (this.failStreak >= 3 && this.authFailures >= 3) {
            this.fail("A ElevenLabs recusou a autorização várias vezes. Avisa quem gere a app.");
            return;
          }
          await this.backoff(run);
        }
      }
    } finally {
      if (this.loopRun === run) this.loopRun = -1;
    }
  }

  private async backoff(run: number): Promise<void> {
    const ms = Math.min(10_000, 1000 * 2 ** Math.min(this.failStreak, 4));
    const until = Date.now() + ms;
    while (Date.now() < until && !this.stopRequested && run === this.runId) {
      await sleep(250);
    }
  }

  private attach(conn: ScribeConnection): void {
    const wasReconnect = this.everConnected;
    this.everConnected = true;
    this.conn = conn;
    conn.offsetSec = null;

    if (wasReconnect) {
      this.pendingPreviousText = this.lastSpeechTail();
      if (this.lostFromSec !== null) {
        const lost = this.droppedSamples > 0;
        const firstQueued = this.queue[0];
        const toSec = lost && firstQueued
          ? this.runBaseSec + firstQueued.startSample / SAMPLE_RATE
          : this.clockSec();
        this.push({
          id: nextId(),
          kind: "gap",
          text: "",
          startSec: this.lostFromSec,
          endSec: toSec,
          lost,
        });
      }
      this.lostFromSec = null;
      this.droppedSamples = 0;
    }

    this.set({ status: "recording", error: null, reconnectAttempt: 0 });
    void this.pump(conn);
  }

  private onClose(conn: ScribeConnection, code: number, reason: string): void {
    this.raw("ws:close", { code, reason });
    if (conn !== this.conn || this.stopRequested) return;
    this.handleConnectionLost(conn);
  }

  private handleConnectionLost(conn: ScribeConnection): void {
    if (Date.now() - conn.openedAt < 20_000) this.failStreak++;
    else this.failStreak = 0;
    this.conn = null;
    conn.close();
    this.flushPartial();
    this.lostFromSec = this.runBaseSec + this.lastSentSample / SAMPLE_RATE;
    this.set({ status: "reconnecting" });
    void this.connectLoop(this.runId, this.failStreak > 0);
  }

  // ---- áudio ----------------------------------------------------------------

  private clockSec(): number {
    return this.runBaseSec + this.captured / SAMPLE_RATE;
  }

  private onChunk(pcm: Int16Array): void {
    const chunk: Chunk = { pcm, startSample: this.captured };
    this.captured += pcm.length;
    if (this.stopRequested) return;
    const conn = this.conn;
    if (conn?.ready && this.queue.length === 0 && !this.pumping) {
      this.sendChunk(conn, chunk);
      return;
    }
    this.queue.push(chunk);
    this.queuedSamples += pcm.length;
    while (this.queuedSamples > MAX_QUEUE_SECONDS * SAMPLE_RATE && this.queue.length > 1) {
      const dropped = this.queue.shift()!;
      this.queuedSamples -= dropped.pcm.length;
      this.droppedSamples += dropped.pcm.length;
    }
    if (conn?.ready) void this.pump(conn);
  }

  private sendChunk(conn: ScribeConnection, chunk: Chunk): void {
    if (conn.offsetSec === null) {
      conn.offsetSec = this.runBaseSec + chunk.startSample / SAMPLE_RATE;
    }
    if (this.pendingPreviousText) this.raw("ws:first_chunk", { previous_text: this.pendingPreviousText });
    conn.sendAudio(chunk.pcm, this.pendingPreviousText);
    this.pendingPreviousText = undefined;
    this.lastSentSample = chunk.startSample + chunk.pcm.length;
  }

  /** Escoa a fila de áudio acumulada, mais depressa do que o tempo real, sem sobrecarregar o servidor. */
  private async pump(conn: ScribeConnection): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const run = this.runId;
    try {
      while (
        this.queue.length &&
        this.conn === conn &&
        conn.ready &&
        !this.stopRequested &&
        run === this.runId
      ) {
        const c = this.queue.shift()!;
        this.queuedSamples -= c.pcm.length;
        this.sendChunk(conn, c);
        await sleep((c.pcm.length / SAMPLE_RATE) * 1000 / DRAIN_SPEED);
      }
    } finally {
      this.pumping = false;
    }
  }

  // ---- mensagens do servidor ------------------------------------------------

  private onMessage(conn: ScribeConnection, m: ServerMessage): void {
    if (conn !== this.conn) return;
    this.raw(`msg:${m.message_type}`, m);

    switch (m.message_type) {
      case "partial_transcript": {
        this.failStreak = 0;
        this.authFailures = 0;
        const text = (m.text ?? "").trim();
        if (text && !this.snap.partial) this.partialStartSec = this.clockSec();
        if (text !== this.snap.partial) this.set({ partial: text });
        return;
      }
      case "committed_transcript":
        this.failStreak = 0;
        this.authFailures = 0;
        this.addCommitted(m.text ?? "");
        return;
      case "committed_transcript_with_timestamps":
        this.addTimestamps(conn, m);
        return;
      case "session_started":
      case "warning":
        return;
      default:
        if (isErrorMessage(m.message_type)) this.handleServerError(conn, m);
    }
  }

  private handleServerError(conn: ScribeConnection, m: ServerMessage): void {
    if (m.message_type === "commit_throttled") return;
    const verdict = classifyServerError(m);
    if (verdict.fatal) {
      this.fail(verdict.message);
      return;
    }
    if (m.message_type === "auth_error") this.authFailures++;
    this.set({ error: verdict.message });
    this.handleConnectionLost(conn);
  }

  private addCommitted(text: string): void {
    const t = text.trim();
    const startSec = this.partialStartSec ?? this.clockSec();
    this.partialStartSec = null;
    this.set({ partial: "" });
    this.commitWaiter?.();
    if (!t) return;

    const seg: Segment = { id: nextId(), kind: "speech", text: t, startSec };
    this.push(seg);

    // Já chegou o evento com timestamps correspondente?
    const idx = this.pendingTs.findIndex((e) => similar(e.text, t));
    const pick = idx >= 0 ? idx : this.pendingTs.length ? 0 : -1;
    if (pick >= 0) {
      const [entry] = this.pendingTs.splice(pick, 1);
      if (entry.timer) clearTimeout(entry.timer);
      this.applyWords(seg.id, entry);
    } else {
      this.unpaired.push(seg.id);
    }
  }

  private addTimestamps(conn: ScribeConnection, m: ServerMessage): void {
    const entry: TimestampEntry = {
      text: m.text ?? "",
      words: m.words ?? [],
      offsetSec: conn.offsetSec ?? this.runBaseSec,
    };
    if (this.pairWithUnpaired(entry)) return;
    // Pode chegar antes do texto confirmado (ou este nunca chegar): esperamos um pouco.
    entry.timer = setTimeout(() => {
      this.pendingTs = this.pendingTs.filter((e) => e !== entry);
      if (this.pairWithUnpaired(entry)) return;
      const t = entry.text.trim();
      if (!t) return;
      const seg: Segment = { id: nextId(), kind: "speech", text: t, startSec: this.clockSec() };
      this.push(seg);
      this.applyWords(seg.id, entry);
    }, TIMESTAMP_PAIR_MS);
    this.pendingTs.push(entry);
  }

  private pairWithUnpaired(entry: TimestampEntry): boolean {
    if (!this.unpaired.length) return false;
    const byId = new Map(this.snap.segments.map((s) => [s.id, s]));
    let i = this.unpaired.findIndex((id) => {
      const s = byId.get(id);
      return s ? similar(s.text, entry.text) : false;
    });
    if (i < 0) i = 0;
    const [id] = this.unpaired.splice(i, 1);
    this.applyWords(id, entry);
    return true;
  }

  private applyWords(segId: string, entry: TimestampEntry): void {
    const words = entry.words.filter(
      (w) => w.type !== "spacing" && typeof w.start === "number",
    );
    if (!words.length) return;
    const first = words[0].start as number;
    const lastWord = words[words.length - 1];
    const last = typeof lastWord.end === "number" ? lastWord.end : (lastWord.start as number);
    const startSec = entry.offsetSec + first;
    const endSec = entry.offsetSec + last;
    const seg = this.snap.segments.find((s) => s.id === segId);
    if (!seg) return;
    if (Math.abs(startSec - seg.startSec) > TIMESTAMP_SANITY_SEC) {
      this.raw("timestamps:ignored", { startSec, estimate: seg.startSec });
      return;
    }
    this.set({
      segments: this.snap.segments.map((s) => (s.id === segId ? { ...s, startSec, endSec } : s)),
    });
  }

  // ---- utilitários ----------------------------------------------------------

  private push(seg: Segment): void {
    this.set({ segments: [...this.snap.segments, seg] });
  }

  /** Converte o texto parcial pendente num segmento provisório. */
  private flushPartial(): void {
    const t = this.snap.partial.trim();
    if (!t) return;
    this.push({
      id: nextId(),
      kind: "speech",
      text: t,
      startSec: this.partialStartSec ?? this.clockSec(),
      provisional: true,
    });
    this.partialStartSec = null;
    this.set({ partial: "" });
  }

  /** Últimos ≤48 caracteres do texto confirmado, para `previous_text` ao reconectar. */
  private lastSpeechTail(): string | undefined {
    for (let i = this.snap.segments.length - 1; i >= 0; i--) {
      const s = this.snap.segments[i];
      if (s.kind !== "speech" || s.provisional) continue;
      if (s.text.length <= 48) return s.text;
      const tail = s.text.slice(-48);
      const space = tail.indexOf(" ");
      return space > 0 ? tail.slice(space + 1) : tail;
    }
    return this.settings.context.trim().slice(0, 50) || undefined;
  }

  private waitForCommit(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.commitWaiter = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.commitWaiter = done;
    });
  }

  private fail(message: string): void {
    this.stopRequested = true;
    this.finishRun();
    this.set({ status: "error", error: message, reconnectAttempt: 0 });
  }

  private finishRun(): void {
    this.flushPartial();
    this.mic?.stop();
    this.mic = null;
    this.conn?.close();
    this.conn = null;
    this.pendingTs.forEach((e) => e.timer && clearTimeout(e.timer));
    this.pendingTs = [];
    this.unpaired = [];
    this.queue = [];
    this.queuedSamples = 0;
    this.timelineSec = this.clockSec();
    this.runId++;
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      this.wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      // sem suporte ou recusado: o ecrã pode apagar-se, mas a gravação continua
    }
  }

  private onVisibility = (): void => {
    if (document.visibilityState === "visible" && !this.stopRequested) {
      void this.acquireWakeLock();
    }
  };

  private raw(kind: string, data?: unknown): void {
    this.rawListener?.(kind, data);
  }

  private set(patch: Partial<SessionSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}
