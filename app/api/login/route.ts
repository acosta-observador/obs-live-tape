import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  checkPassword,
  createSessionToken,
  isAuthConfigured,
} from "@/lib/auth";

// Limite simples de tentativas por IP (em memória: chega para uma só instância).
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "desconhecido";
}

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      {
        error: "servidor_mal_configurado",
        message: "O servidor não tem APP_ACCESS_PASSWORD definida.",
      },
      { status: 500 },
    );
  }

  const ip = clientIp(request);
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      {
        error: "demasiadas_tentativas",
        message: "Demasiadas tentativas. Espera alguns minutos e tenta de novo.",
      },
      { status: 429 },
    );
  }

  let password = "";
  try {
    const body = await request.json();
    if (typeof body?.password === "string") password = body.password;
  } catch {
    // corpo inválido: tratado como palavra-passe vazia
  }

  if (!(await checkPassword(password))) {
    const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + WINDOW_MS };
    current.count += 1;
    attempts.set(ip, current);
    return NextResponse.json(
      { error: "palavra_passe_errada", message: "Palavra-passe incorreta." },
      { status: 401 },
    );
  }

  attempts.delete(ip);
  const token = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
