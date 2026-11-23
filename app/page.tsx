"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type TokenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; preview: string }
  | { status: "error"; message: string };

/**
 * Página provisória da etapa 1: só serve para verificar que o login e a rota
 * do token funcionam. Será substituída pelo ecrã de transcrição na etapa 2.
 */
export default function Home() {
  const router = useRouter();
  const [state, setState] = useState<TokenState>({ status: "idle" });

  async function testToken() {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/scribe-token", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok || !body?.token) {
        setState({
          status: "error",
          message: body?.message ?? "Erro ao pedir o token.",
        });
        return;
      }
      // Mostramos só o início: o token completo não precisa de aparecer no ecrã.
      setState({ status: "ok", preview: `${String(body.token).slice(0, 8)}…` });
    } catch {
      setState({
        status: "error",
        message: "Sem ligação ao servidor. Verifica a rede e tenta de novo.",
      });
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col">
      <p className="border-b border-border bg-surface px-4 py-2 text-center text-xs text-muted">
        Transcrição automática. Confirmar citações contra o áudio.
      </p>

      <header className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">OBS Live Tape</h1>
        <button onClick={logout} className="text-sm text-muted underline">
          Sair
        </button>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-base font-semibold">Etapa 1: verificação da ligação</h2>
          <p className="mt-2 text-sm text-muted">
            Confirma que o servidor consegue pedir um token de curta duração à
            ElevenLabs. A transcrição chega na etapa 2.
          </p>

          <button
            onClick={testToken}
            disabled={state.status === "loading"}
            className="mt-4 rounded-lg bg-accent px-4 py-3 text-base font-semibold text-accent-contrast disabled:opacity-50"
          >
            {state.status === "loading" ? "A pedir…" : "Testar token"}
          </button>

          {state.status === "ok" && (
            <p role="status" className="mt-4 text-sm text-ok">
              Token recebido ({state.preview}). A ligação ao servidor está a funcionar.
            </p>
          )}
          {state.status === "error" && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {state.message}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
