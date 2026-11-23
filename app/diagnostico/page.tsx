"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatClock } from "@/lib/format";
import { LiveSessionController } from "@/lib/session/controller";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";

interface LogLine {
  n: number;
  t: string;
  kind: string;
  data: string;
}

const MAX_LINES = 300;
const fieldClass = "mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm";

/**
 * Página técnica: liga ao Scribe com os parâmetros escolhidos e mostra as
 * mensagens em bruto. Serve para validar idioma (pt/por), modelo (v2/v3),
 * vocabulário e a forma dos timestamps no browser real.
 */
export default function DiagnosticoPage() {
  const [controller] = useState(() => new LiveSessionController());
  const snap = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const [cfg, setCfg] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [log, setLog] = useState<LogLine[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let n = 0;
    controller.setRawListener((kind, data) => {
      n++;
      const line: LogLine = {
        n,
        t: new Date().toLocaleTimeString("pt-PT"),
        kind,
        data: data === undefined ? "" : JSON.stringify(data).slice(0, 600),
      };
      setLog((prev) => [...prev.slice(-(MAX_LINES - 1)), line]);
      if (kind.startsWith("msg:") || kind.startsWith("ws:")) {
        setCounts((prev) => ({ ...prev, [kind]: (prev[kind] ?? 0) + 1 }));
      }
    });
    return () => {
      controller.setRawListener(null);
      controller.dispose();
    };
  }, [controller]);

  const running = snap.status === "connecting" || snap.status === "recording" || snap.status === "reconnecting";
  const set = (patch: Partial<Settings>) => setCfg((c) => ({ ...c, ...patch }));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Diagnóstico do Scribe Realtime</h1>
        <Link href="/" className="text-sm text-muted underline">
          Voltar
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted">
        Liga ao Scribe com estes parâmetros e fala para o microfone. As mensagens aparecem em
        bruto em baixo.
      </p>

      <fieldset disabled={running} className="mt-4 grid grid-cols-2 gap-3 disabled:opacity-60">
        <div>
          <label htmlFor="m" className="text-xs text-muted">Modelo</label>
          <select id="m" value={cfg.modelId} onChange={(e) => set({ modelId: e.target.value })} className={fieldClass}>
            <option value="scribe_v2_realtime">scribe_v2_realtime</option>
            <option value="scribe_v3_live">scribe_v3_live</option>
          </select>
        </div>
        <div>
          <label htmlFor="l" className="text-xs text-muted">language_code</label>
          <select id="l" value={cfg.language} onChange={(e) => set({ language: e.target.value })} className={fieldClass}>
            <option value="pt">pt</option>
            <option value="por">por</option>
            <option value="">(automático)</option>
          </select>
        </div>
        <div className="col-span-2">
          <label htmlFor="k" className="text-xs text-muted">keyterms (separados por vírgula)</label>
          <input id="k" value={cfg.vocabulary} onChange={(e) => set({ vocabulary: e.target.value })} placeholder="TAP, Galp, Chega" className={fieldClass} />
        </div>
        <div>
          <label htmlFor="c" className="text-xs text-muted">Contexto (previous_text inicial)</label>
          <input id="c" value={cfg.context} maxLength={50} onChange={(e) => set({ context: e.target.value })} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="v" className="text-xs text-muted">vad_silence_threshold_secs</label>
          <select id="v" value={String(cfg.vadSilenceSecs)} onChange={(e) => set({ vadSilenceSecs: Number(e.target.value) })} className={fieldClass}>
            <option value="0.8">0.8</option>
            <option value="1.2">1.2</option>
            <option value="2">2</option>
          </select>
        </div>
      </fieldset>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => (running ? controller.stop() : controller.start(cfg))}
          className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-contrast"
        >
          {running ? "Parar" : "Ligar e escutar"}
        </button>
        <span className="text-sm text-muted">
          Estado: <strong className="text-foreground">{snap.status}</strong>
        </span>
        <button onClick={() => { setLog([]); setCounts({}); }} className="ml-auto text-sm text-muted underline">
          Limpar registo
        </button>
      </div>

      {snap.error && (
        <p role="alert" className="mt-3 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
          {snap.error}
        </p>
      )}

      <section className="mt-5">
        <h2 className="text-sm font-semibold">Mensagens recebidas</h2>
        <p className="mt-1 font-mono text-xs text-muted">
          {Object.keys(counts).length === 0
            ? "(nenhuma ainda)"
            : Object.entries(counts).map(([k, v]) => `${k.replace("msg:", "")}×${v}`).join("  ")}
        </p>
      </section>

      <section className="mt-5">
        <h2 className="text-sm font-semibold">Segmentos ({snap.segments.length})</h2>
        <ul className="mt-1 space-y-1 text-sm">
          {snap.segments.map((s) => (
            <li key={s.id} className="font-mono text-xs">
              [{formatClock(s.startSec)}{s.endSec !== undefined ? `–${formatClock(s.endSec)}` : ""}] {s.kind === "gap" ? "(interrupção)" : s.text}
            </li>
          ))}
          {snap.partial && <li className="font-mono text-xs text-muted">… {snap.partial}</li>}
        </ul>
      </section>

      <section className="mt-5">
        <h2 className="text-sm font-semibold">Registo em bruto</h2>
        <div className="mt-1 max-h-[50dvh] overflow-y-auto rounded-lg border border-border bg-surface p-2 font-mono text-[11px] leading-snug">
          {log.length === 0 && <span className="text-muted">(vazio)</span>}
          {log.map((l) => (
            <div key={l.n} className="break-all">
              <span className="text-muted">{l.t}</span>{" "}
              <span className="text-accent">{l.kind}</span> {l.data}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
