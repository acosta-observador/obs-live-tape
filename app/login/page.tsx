"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.message ?? "Não foi possível entrar. Tenta de novo.");
    } catch {
      setError("Sem ligação ao servidor. Verifica a rede e tenta de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-10">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6"
      >
        <p className="text-sm text-muted">Observador</p>
        <h1 className="mt-1 text-2xl font-semibold">OBS Live Tape</h1>
        <p className="mt-2 text-sm text-muted">
          Ferramenta interna de transcrição em direto.
        </p>

        <label htmlFor="password" className="mt-6 block text-sm text-muted">
          Palavra-passe
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-3 text-base"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="mt-5 w-full rounded-lg bg-accent px-4 py-3 text-base font-semibold text-accent-contrast disabled:opacity-50"
        >
          {busy ? "A entrar…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
