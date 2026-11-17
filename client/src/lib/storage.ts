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
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // stockage indisponible : on ignore
    }
  },
  getJson<T>(key: string): T | null {
    const raw = storage.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setJson(key: string, value: unknown): void {
    storage.set(key, JSON.stringify(value));
  },
};

export const STORAGE_KEYS = {
  pseudo: 'bta:pseudo',
  lang: 'bta:lang',
  settings: 'bta:settings',
  volume: 'bta:volume',
  history: 'bta:history',
  playerKey: 'bta:playerKey',
  room: 'bta:room',
} as const;
