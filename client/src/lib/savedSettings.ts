import {
  DEFAULT_SETTINGS,
  SOLO_MODES,
  sanitizeSettings,
  type GameSettings,
} from '@blindtest/shared';
import { storage, STORAGE_KEYS } from './storage';

/** Derniers réglages utilisés (solo ou room dont on est l'hôte). */
export function loadSavedSettings(context: 'solo' | 'room' = 'solo'): GameSettings {
  const saved = sanitizeSettings(storage.getJson(STORAGE_KEYS.settings)) ?? DEFAULT_SETTINGS;
  // Un mode réservé au multi (Playlist, Enchères) ne se joue pas en solo.
  if (context === 'solo' && !SOLO_MODES.includes(saved.mode)) {
    return { ...saved, mode: DEFAULT_SETTINGS.mode };
  }
  return saved;
}

export function saveSettings(settings: GameSettings): void {
  storage.setJson(STORAGE_KEYS.settings, settings);
}
