/**
 * Autenticação por palavra-passe partilhada.
 *
 * O cookie de sessão tem o formato `v1.<expiração em segundos>.<assinatura>`.
 * A assinatura é um HMAC-SHA256 calculado com um segredo derivado de
 * APP_ACCESS_PASSWORD (e, opcionalmente, SESSION_SECRET). Consequências:
 *  - não guardamos sessões no servidor (nada a perder se o serviço reiniciar);
 *  - mudar a palavra-passe invalida automaticamente todas as sessões.
 *
 * Só usa Web Crypto, por isso funciona tanto no proxy.ts como nas rotas.
 */

export const SESSION_COOKIE = "obs_session";
/** Duração da sessão: cobre um dia inteiro de audições. */
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

const encoder = new TextEncoder();

function getSecret(): string | null {
  const password = process.env.APP_ACCESS_PASSWORD;
  if (!password) return null;
  return `${password}::${process.env.SESSION_SECRET ?? ""}`;
}

/** Indica se o servidor está configurado para autenticar. */
export function isAuthConfigured(): boolean {
  return getSecret() !== null;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/** Comparação em tempo constante (evita ataques de temporização). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifica a palavra-passe introduzida contra a configurada. */
export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.APP_ACCESS_PASSWORD;
  if (!expected) return false;
  // Comparamos hashes do mesmo tamanho para não revelar o comprimento.
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(input)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return safeEqual(toHex(a), toHex(b));
}

export async function createSessionToken(): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `v1.${exp}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  const secret = getSecret();
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = await sign(`${parts[0]}.${parts[1]}`, secret);
  return safeEqual(expected, parts[2]);
}
