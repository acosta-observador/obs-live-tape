/**
 * Protocolo do Scribe Realtime (WebSocket), conforme a referência oficial:
 *   wss://api.elevenlabs.io/v1/speech-to-text/realtime
 *
 * Cliente -> servidor: input_audio_chunk { audio_base_64, commit, sample_rate, previous_text? }
 * Servidor -> cliente: session_started, partial_transcript, committed_transcript,
 *   committed_transcript_with_timestamps e vários tipos de erro.
 */

export interface ScribeWord {
  text: string;
  start?: number;
  end?: number;
  type?: "word" | "spacing" | "audio_event";
}

export interface ServerMessage {
  message_type: string;
  text?: string;
  error?: string;
  warning?: string;
  session_id?: string;
  config?: Record<string, unknown>;
  words?: ScribeWord[] | null;
  language_code?: string | null;
}

/** Erro que não adianta tentar de novo (configuração, quota, pedido inválido). */
export class FatalError extends Error {}
/** Erro temporário: vale a pena tentar reconectar. */
export class RetryableError extends Error {}

export interface ErrorVerdict {
  fatal: boolean;
  message: string;
}

/** Tipos de mensagem do servidor que representam erros. */
const ERROR_TYPES = new Set([
  "error",
  "auth_error",
  "quota_exceeded",
  "commit_throttled",
  "unaccepted_terms",
  "rate_limited",
  "queue_overflow",
  "resource_exhausted",
  "session_time_limit_exceeded",
  "input_error",
  "invalid_request",
  "chunk_size_exceeded",
  "insufficient_audio_activity",
  "transcriber_error",
]);

export function isErrorMessage(type: string): boolean {
  return ERROR_TYPES.has(type);
}

/** Traduz um erro do servidor numa mensagem em português e decide se é fatal. */
export function classifyServerError(m: ServerMessage): ErrorVerdict {
  const detail = m.error ? ` (${m.error})` : "";
  switch (m.message_type) {
    case "quota_exceeded":
      return {
        fatal: true,
        message: "A quota da ElevenLabs esgotou-se. Avisa quem gere a conta.",
      };
    case "unaccepted_terms":
      return {
        fatal: true,
        message:
          "A conta da ElevenLabs tem termos por aceitar. Quem gere a conta tem de os aceitar no site da ElevenLabs.",
      };
    case "invalid_request":
    case "input_error":
    case "chunk_size_exceeded":
      return {
        fatal: true,
        message: `A ElevenLabs recusou o pedido${detail}. Reporta este erro.`,
      };
    case "auth_error":
      return {
        fatal: false,
        message: "A ElevenLabs recusou a autorização (token expirado ou inválido).",
      };
    case "session_time_limit_exceeded":
      return {
        fatal: false,
        message: "A sessão atingiu o limite de duração; a renovar automaticamente.",
      };
    case "rate_limited":
    case "queue_overflow":
    case "resource_exhausted":
      return {
        fatal: false,
        message: "A ElevenLabs está sobrecarregada neste momento.",
      };
    default:
      return {
        fatal: false,
        message: `Erro temporário no serviço de transcrição${detail}.`,
      };
  }
}
