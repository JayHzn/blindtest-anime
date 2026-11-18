import type { GameSettings } from '@blindtest/shared';
import { storage, STORAGE_KEYS } from './storage';

/** Partie terminée, gardée dans le navigateur. */
export interface PlayedGame {
  date: string;
  score: number;
  found: number;
  rounds: number;
  settingsKey: string;
}

const MAX_ENTRIES = 50;

/** Les records ne se comparent qu'entre parties aux réglages identiques. */
export function settingsKey(settings: GameSettings): string {
  const { mode, rounds, filters } = settings;
  const types = [...filters.types].sort().join('+');
  const years = `${filters.yearFrom ?? ''}-${filters.yearTo ?? ''}`;
  // Plus ou moins : pas de manches (la partie dure jusqu'à l'erreur).
  const length = mode === 'higherLower' ? '-' : rounds;
  return `${mode}|${length}|${filters.popularity}|${types}|${years}`;
}

export function readHistory(): PlayedGame[] {
  return storage.getJson<PlayedGame[]>(STORAGE_KEYS.history) ?? [];
}

/** Enregistre la partie ; renvoie l'ancien record pour ces réglages (null si aucun). */
export function recordGame(game: PlayedGame): number | null {
  const history = readHistory();
  const previous = history.filter((g) => g.settingsKey === game.settingsKey);
  const best = previous.length > 0 ? Math.max(...previous.map((g) => g.score)) : null;
  storage.setJson(STORAGE_KEYS.history, [game, ...history].slice(0, MAX_ENTRIES));
  return best;
}
