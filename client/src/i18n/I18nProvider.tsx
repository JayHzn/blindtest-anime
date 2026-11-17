import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { storage, STORAGE_KEYS } from '../lib/storage';
import { en } from './en';
import { fr, type MessageKey } from './fr';
import { I18nContext, LANGS, type Lang } from './context';

const dictionaries: Record<Lang, Record<MessageKey, string>> = { fr, en };

function detectLang(): Lang {
  const saved = storage.get(STORAGE_KEYS.lang);
  if (saved && (LANGS as readonly string[]).includes(saved)) return saved as Lang;
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    storage.set(STORAGE_KEYS.lang, next);
    setLangState(next);
  }, []);

  const value = useMemo(
    () => ({ lang, setLang, t: (key: MessageKey) => dictionaries[lang][key] }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
