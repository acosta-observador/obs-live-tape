import { useSyncExternalStore } from "react";

/** Definições do jornalista, guardadas no browser (localStorage). */
export interface Settings {
  /** Modelo realtime da ElevenLabs. */
  modelId: string;
  /** Código de idioma (ISO 639-1/3). Vazio = deteção automática. */
  language: string;
  /** Contexto curto enviado como previous_text no início (máx. 50 caracteres). */
  context: string;
  /** Vocabulário personalizado: um termo por linha (ou separados por vírgulas). */
  vocabulary: string;
  /** Reduz falsas deteções de conversas de fundo na sala. */
  filterBackground: boolean;
  /** Segundos de silêncio para fechar uma frase (VAD). */
  vadSilenceSecs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  modelId: "scribe_v2_realtime",
  language: "pt",
  context: "",
  vocabulary: "",
  filterBackground: false,
  vadSilenceSecs: 1.2,
};

export const MAX_KEYTERMS = 50;
export const MAX_KEYTERM_LENGTH = 50;
export const MAX_CONTEXT_LENGTH = 50;

/** Converte o texto do campo de vocabulário numa lista limpa e sem repetições. */
export function parseVocabulary(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const term = raw.trim();
    if (!term || term.length > MAX_KEYTERM_LENGTH) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}

// --- Pequeno store externo, para ler/gravar o localStorage sem problemas de hidratação ---

const STORAGE_KEY = "obs-live-tape:settings:v1";
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // localStorage indisponível ou conteúdo inválido: usamos os valores por defeito
  }
  return DEFAULT_SETTINGS;
}

function getSnapshot(): Settings {
  if (!cache) cache = load();
  return cache;
}

function getServerSnapshot(): Settings {
  return DEFAULT_SETTINGS;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateSettings(patch: Partial<Settings>): void {
  cache = { ...getSnapshot(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // sem espaço ou bloqueado: as definições só valem nesta sessão do browser
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
