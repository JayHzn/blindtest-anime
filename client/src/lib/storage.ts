/**
 * Accès au localStorage tolérant aux erreurs (navigation privée, stockage bloqué…).
 * Le site doit fonctionner même si rien ne peut être sauvegardé.
 */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // stockage indisponible : on ignore
    }
  },
};

export const STORAGE_KEYS = {
  pseudo: 'bta:pseudo',
  lang: 'bta:lang',
} as const;
