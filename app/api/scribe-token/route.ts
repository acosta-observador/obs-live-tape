import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Cada token é de uso único: o pedido é sempre dinâmico (POST + cookies) e a
// resposta leva Cache-Control: no-store. Não usar `export const dynamic` aqui,
// é incompatível com cacheComponents no Next 16.
// ELEVENLABS_API_BASE permite usar os endpoints de residência de dados (ex.: UE) ou um servidor de testes.
const API_BASE = process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io";
const TOKEN_PATH = "/v1/single-use-token/realtime_scribe";

/**
 * Gera um token de curta duração (uso único, 15 min para ser usado) para o
 * browser se ligar diretamente ao Scribe Realtime. A chave da ElevenLabs nunca
 * sai daqui: devolvemos apenas o token.
 *
 * Variáveis opcionais:
 *  - SCRIBE_MAX_SESSION_SECONDS: fecha a sessão realtime ao fim de N segundos.
 *
 * Não registamos nada que contenha áudio ou texto; só o estado do pedido.
 */
export async function POST() {
  // Segunda camada de proteção (o proxy.ts já filtra, mas esta rota é crítica).
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(session))) {
    return NextResponse.json(
      { error: "nao_autenticado", message: "Sessão expirada. Volta a entrar." },
      { status: 401 },
    );
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "servidor_mal_configurado",
        message: "O servidor não tem ELEVENLABS_API_KEY definida.",
      },
      { status: 500 },
    );
  }

  const url = new URL(TOKEN_PATH, API_BASE);
  const maxSeconds = Number(process.env.SCRIBE_MAX_SESSION_SECONDS);
  if (Number.isInteger(maxSeconds) && maxSeconds > 0) {
    url.searchParams.set("max_session_duration_seconds", String(maxSeconds));
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json(
      {
        error: "elevenlabs_indisponivel",
        message: "Não foi possível contactar a ElevenLabs. Tenta de novo.",
      },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    // Registamos só o código e o motivo do erro da ElevenLabs (não contém áudio nem texto).
    const detail = await upstream.text().catch(() => "");
    console.error(`[scribe-token] ElevenLabs respondeu ${upstream.status}: ${detail.slice(0, 300)}`);
    if (upstream.status === 401 || upstream.status === 403) {
      return NextResponse.json(
        {
          error: "chave_invalida",
          message: "A chave da ElevenLabs foi recusada. Avisa quem gere a app.",
        },
        { status: 502 },
      );
    }
    if (upstream.status === 429) {
      return NextResponse.json(
        {
          error: "quota_ou_limite",
          message: "Limite de utilização da ElevenLabs atingido. Tenta daqui a pouco.",
        },
        { status: 429 },
      );
    }
    return NextResponse.json(
      {
        error: "elevenlabs_erro",
        message: "A ElevenLabs devolveu um erro ao criar o token.",
      },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as { token?: string };
  if (!data.token) {
    return NextResponse.json(
      { error: "resposta_invalida", message: "Resposta inesperada da ElevenLabs." },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { token: data.token },
    { headers: { "Cache-Control": "no-store" } },
  );
}
