"use client";

import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/format";
import type { Segment, SessionStatus } from "@/lib/session/controller";

/** Distância ao fundo (px) a partir da qual consideramos que o utilizador subiu. */
const STICK_THRESHOLD = 80;

/**
 * Lista da transcrição. Confirmado em branco (tema escuro), parcial a cinzento.
 * O scroll acompanha o texto novo, mas pára se o utilizador subir na página.
 */
export default function TranscriptView({
  segments,
  partial,
  status,
}: {
  segments: Segment[];
  partial: string;
  status: SessionStatus;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const [stuck, setStuck] = useState(true);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stuckRef.current = atBottom;
    setStuck(atBottom);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stuckRef.current) el.scrollTop = el.scrollHeight;
  }, [segments, partial]);

  const jumpToEnd = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stuckRef.current = true;
    setStuck(true);
  };

  const empty = segments.length === 0 && !partial;
  const listening = status === "recording" && empty;

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-4 py-4"
        aria-live="off"
      >
        <div className="mx-auto max-w-3xl space-y-5 pb-6">
          {empty && (
            <p className="pt-10 text-center text-base text-muted">
              {listening
                ? "À escuta… o texto aparece aqui assim que alguém falar."
                : "Carrega no botão laranja para começar a transcrever."}
            </p>
          )}

          {segments.map((seg) =>
            seg.kind === "gap" ? (
              <GapNote key={seg.id} seg={seg} />
            ) : (
              <article key={seg.id}>
                <time className="font-mono text-xs text-muted">
                  {formatClock(seg.startSec)}
                </time>
                <p
                  className={`mt-0.5 text-xl leading-relaxed md:text-2xl md:leading-relaxed ${
                    seg.provisional ? "italic text-muted" : "text-foreground"
                  }`}
                >
                  {seg.text}
                  {seg.provisional && (
                    <span className="ml-2 text-sm not-italic">(não confirmado)</span>
                  )}
                </p>
              </article>
            ),
          )}

          {partial && (
            <p className="text-xl leading-relaxed text-muted md:text-2xl md:leading-relaxed">
              {partial}
            </p>
          )}
        </div>
      </div>

      {!stuck && (
        <button
          onClick={jumpToEnd}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-foreground shadow-lg"
        >
          Ir para o fim ↓
        </button>
      )}
    </div>
  );
}

function GapNote({ seg }: { seg: Segment }) {
  const range = `${formatClock(seg.startSec)} a ${formatClock(seg.endSec ?? seg.startSec)}`;
  return (
    <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground">
      <strong className="font-semibold">Ligação interrompida</strong> ({range}).{" "}
      {seg.lost
        ? "Parte do áudio ficou sem transcrição; confirma no áudio gravado."
        : "O áudio desse intervalo foi transcrito depois da reconexão."}
    </div>
  );
}
