import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * Protege toda a aplicação (páginas e APIs) com a sessão por palavra-passe.
 * Exceções: a página de login e a rota que valida a palavra-passe.
 * (Em Next.js 16 o antigo "middleware" chama-se "proxy".)
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login" || pathname === "/api/login") {
    return NextResponse.next();
  }

  const ok = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "nao_autenticado", message: "Sessão expirada. Volta a entrar." },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Tudo exceto ficheiros estáticos do Next e o favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
