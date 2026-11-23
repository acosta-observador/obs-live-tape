"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import LevelBars from "@/components/LevelBars";
import SettingsSheet from "@/components/SettingsSheet";
import TranscriptView from "@/components/TranscriptView";
import { formatClock } from "@/lib/format";
import { LiveSessionController, type SessionStatus } from "@/lib/session/controller";
import { useSettings } from "@/lib/settings";

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: "Parado",
  connecting: "A ligar…",
  recording: "A gravar",
  reconnecting: "A reconectar…",
  stopping: "A terminar…",
  error: "Erro",
};

const STATUS_DOT: Record<SessionStatus, string> = {
  idle: "bg-muted",
  connecting: "bg-accent animate-pulse",
  recording: "bg-accent animate-pulse",
  reconnecting: "bg-danger animate-pulse",
  stopping: "bg-muted animate-pulse",
  error: "bg-danger",
};

export default function LiveScreen() {
  const router = useRouter();
  const [controller] = useState(() => new LiveSessionController());
  const snap = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const settings = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);

  const running =
    snap.status === "connecting" || snap.status === "recording" || snap.status === "reconnecting";
  const busy = running || snap.status === "stopping";

  // Relógio da sessão (4 vezes por segundo).
  useEffect(() => {
    const id = setInterval(() => setElapsed(controller.elapsedSec()), 250);
    return () => clearInterval(id);
  }, [controller]);

  // Pára tudo se o ecrã for fechado.
  useEffect(() => () => controller.dispose(), [controller]);

  // Evita perder a sessão por um refresh acidental durante a gravação.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function copyText() {
    const text = snap.segments
      .map((s) =>
        s.kind === "gap"
          ? `[${formatClock(s.startSec)}] --- ligação interrompida até ${formatClock(s.endSec ?? s.startSec)} ---`
          : `[${formatClock(s.startSec)}] ${s.text}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // sem permissão para a área de transferência
    }
  }

  async function logout() {
    if (busy && !confirm("Há uma gravação em curso. Sair agora termina-a. Continuar?")) return;
    await controller.stop();
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  function newSession() {
    if (!confirm("Apagar toda a transcrição desta sessão? Não é possível desfazer.")) return;
    controller.reset();
    setElapsed(0);
    setShowSettings(false);
  }

  return (
    <div className="flex h-dvh flex-col">
      <p className="border-b border-border bg-surface px-4 py-1.5 text-center text-xs text-muted">
        Transcrição automática. Confirmar citações contra o áudio.
      </p>

      <header className="px-4 pt-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-2" role="status">
            <span className={`size-2.5 rounded-full ${STATUS_DOT[snap.status]}`} />
            <span className="text-sm font-medium">
              {STATUS_LABEL[snap.status]}
              {snap.status === "reconnecting" && snap.reconnectAttempt > 1
                ? ` (tentativa ${snap.reconnectAttempt})`
                : ""}
            </span>
          </div>
          <span className="text-3xl font-light tabular-nums tracking-tight">
            {formatClock(elapsed)}
          </span>
          <button onClick={logout} className="text-sm text-muted underline">
            Sair
          </button>
        </div>
        <div className="mx-auto mt-2 max-w-3xl">
          <LevelBars controller={controller} active={snap.status === "recording"} />
        </div>
        {snap.error && (
          <p
            role="alert"
            className="mx-auto mt-2 max-w-3xl rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {snap.error}
          </p>
        )}
      </header>

      <TranscriptView segments={snap.segments} partial={snap.partial} status={snap.status} />

      <footer className="border-t border-border bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <button
            onClick={() => setShowSettings(true)}
            className="w-20 text-left text-sm text-muted"
          >
            Definições
          </button>

          <div className="flex flex-col items-center gap-1">
            <button
              onClick={() => (running ? controller.stop() : controller.start(settings))}
              disabled={snap.status === "stopping"}
              aria-label={running ? "Parar a transcrição" : "Iniciar a transcrição"}
              className="grid size-[72px] place-items-center rounded-full bg-accent text-accent-contrast shadow-[0_0_0_8px_rgba(243,119,72,0.15)] disabled:opacity-50"
            >
              {running ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
              ) : (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
                </svg>
              )}
            </button>
            <span className="text-xs text-muted">{running ? "Parar" : "Iniciar"}</span>
          </div>

          <button
            onClick={copyText}
            disabled={snap.segments.length === 0}
            className="w-20 text-right text-sm text-muted disabled:opacity-40"
          >
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      </footer>

      {showSettings && (
        <SettingsSheet
          settings={settings}
          locked={busy}
          hasTranscript={snap.segments.length > 0}
          onClose={() => setShowSettings(false)}
          onNewSession={newSession}
        />
      )}
    </div>
  );
}
