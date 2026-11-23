import { FatalError, RetryableError } from "@/lib/scribe/protocol";

/**
 * Pede ao nosso servidor um token de uso único para o Scribe Realtime.
 * O token é consumido ao ligar, por isso pedimos um novo em cada (re)ligação.
 */
export async function fetchToken(): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/scribe-token", { method: "POST", cache: "no-store" });
  } catch {
    throw new RetryableError("Sem ligação à internet.");
  }

  if (res.status === 401) {
    throw new FatalError(
      "A tua sessão na app expirou. Volta a entrar (o texto já transcrito continua neste ecrã).",
    );
  }

  const body = (await res.json().catch(() => null)) as {
    token?: string;
    message?: string;
    error?: string;
  } | null;

  if (res.ok && body?.token) return body.token;

  const message = body?.message ?? "Não foi possível obter autorização para transcrever.";
  // 500 = servidor mal configurado (falta a chave): repetir não ajuda.
  if (res.status === 500 || body?.error === "chave_invalida") throw new FatalError(message);
  throw new RetryableError(message);
}
