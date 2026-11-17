import { createContext, useContext } from 'react';
import type { MessageKey } from './fr';

export const LANGS = ['fr', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export type MessageVars = Record<string, string | number>;

export interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Texte traduit ; `{nom}` est remplacé par `vars.nom`. */
  t: (key: MessageKey, vars?: MessageVars) => string;
}

export const I18nContext = createContext<I18nValue | null>(null);

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n doit être utilisé dans <I18nProvider>');
  return value;
}

export function interpolate(text: string, vars?: MessageVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
