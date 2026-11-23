"use client";

import { useEffect, useRef } from "react";
import type { LiveSessionController } from "@/lib/session/controller";

const BARS = 56;

/**
 * Indicador do nível do microfone: barras verticais (como a onda da referência
 * de design) que avançam da direita para a esquerda. Desenha num canvas para não
 * obrigar o React a atualizar 20 vezes por segundo.
 */
export default function LevelBars({
  controller,
  active,
}: {
  controller: LiveSessionController;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<number[]>(new Array(BARS).fill(0));
  const latestRef = useRef(0);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
    if (!active) latestRef.current = 0;
  }, [active]);

  useEffect(() => {
    const unsubscribe = controller.subscribeLevel((level) => {
      latestRef.current = level;
    });

    const canvas = canvasRef.current;
    if (!canvas) return unsubscribe;
    const ctx = canvas.getContext("2d");
    if (!ctx) return unsubscribe;

    let raf = 0;
    let lastPush = 0;
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--accent").trim() || "#f37748";
    const idle = styles.getPropertyValue("--border").trim() || "#2a2c31";

    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (now - lastPush > 50) {
        lastPush = now;
        const levels = levelsRef.current;
        levels.push(latestRef.current);
        levels.shift();
      }

      const levels = levelsRef.current;
      const slot = w / BARS;
      const barW = Math.max(2, slot * 0.55);
      ctx.fillStyle = activeRef.current ? accent : idle;
      for (let i = 0; i < BARS; i++) {
        const v = levels[i];
        const barH = Math.max(3, v * (h - 4));
        const x = i * slot + (slot - barW) / 2;
        const y = (h - barH) / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, barW / 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [controller]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Nível do microfone"
      role="img"
      className="h-12 w-full"
    />
  );
}
