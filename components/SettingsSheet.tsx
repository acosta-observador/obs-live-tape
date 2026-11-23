"use client";

import Link from "next/link";
import {
  MAX_CONTEXT_LENGTH,
  MAX_KEYTERMS,
  parseVocabulary,
  updateSettings,
  type Settings,
} from "@/lib/settings";

const fieldClass =
  "mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-base";

/** Painel de definições (em baixo no telemóvel). As alterações valem na próxima gravação. */
export default function SettingsSheet({
  settings,
  locked,
  hasTranscript,
  onClose,
  onNewSession,
}: {
  settings: Settings;
  /** Bloqueia os campos enquanto há uma gravação em curso. */
  locked: boolean;
  hasTranscript: boolean;
  onClose: () => void;
  onNewSession: () => void;
}) {
  const terms = parseVocabulary(settings.vocabulary);

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Definições"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 sm:rounded-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Definições</h2>
          <button onClick={onClose} className="text-sm text-muted underline">
            Fechar
          </button>
        </div>
        {locked && (
          <p className="mt-2 text-sm text-muted">
            Estas definições só podem ser alteradas com a gravação parada.
          </p>
        )}

        <fieldset disabled={locked} className="mt-4 space-y-4 disabled:opacity-60">
          <div>
            <label htmlFor="vocab" className="text-sm text-muted">
              Vocabulário (nomes, siglas, partidos): um por linha
            </label>
            <textarea
              id="vocab"
              rows={5}
              value={settings.vocabulary}
              onChange={(e) => updateSettings({ vocabulary: e.target.value })}
              placeholder={"TAP\nGalp\nChega\nLivre"}
              className={fieldClass}
            />
            <p className="mt-1 text-xs text-muted">
              {terms.length} de {MAX_KEYTERMS} termos (máx. 50 caracteres cada).
            </p>
          </div>

          <div>
            <label htmlFor="context" className="text-sm text-muted">
              Contexto (opcional, ajuda o modelo no início)
            </label>
            <input
              id="context"
              type="text"
              maxLength={MAX_CONTEXT_LENGTH}
              value={settings.context}
              onChange={(e) => updateSettings({ context: e.target.value })}
              placeholder="Comissão de inquérito à TAP"
              className={fieldClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="lang" className="text-sm text-muted">
                Idioma
              </label>
              <select
                id="lang"
                value={settings.language}
                onChange={(e) => updateSettings({ language: e.target.value })}
                className={fieldClass}
              >
                <option value="pt">Português</option>
                <option value="">Automático</option>
              </select>
            </div>
            <div>
              <label htmlFor="vad" className="text-sm text-muted">
                Pausa para fechar frase
              </label>
              <select
                id="vad"
                value={String(settings.vadSilenceSecs)}
                onChange={(e) => updateSettings({ vadSilenceSecs: Number(e.target.value) })}
                className={fieldClass}
              >
                <option value="0.8">Curta (0,8 s)</option>
                <option value="1.2">Normal (1,2 s)</option>
                <option value="2">Longa (2 s)</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-3 text-base">
            <input
              type="checkbox"
              checked={settings.filterBackground}
              onChange={(e) => updateSettings({ filterBackground: e.target.checked })}
              className="size-5 accent-[var(--accent)]"
            />
            Ignorar conversas e ruído de fundo
          </label>
        </fieldset>

        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <Link href="/diagnostico" className="text-sm text-muted underline">
            Diagnóstico técnico
          </Link>
          <button
            onClick={onNewSession}
            disabled={locked || !hasTranscript}
            className="rounded-lg border border-danger/60 px-3 py-2 text-sm text-danger disabled:opacity-40"
          >
            Nova sessão (apaga o texto)
          </button>
        </div>
      </div>
    </div>
  );
}
