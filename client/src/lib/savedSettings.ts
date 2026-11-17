import { DEFAULT_SETTINGS, sanitizeSettings, type GameSettings } from '@blindtest/shared';
import { storage, STORAGE_KEYS } from './storage';

/** Derniers réglages utilisés (solo ou room dont on est l'hôte). */
export function loadSavedSettings(): GameSettings {
  return sanitizeSettings(storage.getJson(STORAGE_KEYS.settings)) ?? DEFAULT_SETTINGS;
}

export function saveSettings(settings: GameSettings): void {
  storage.setJson(STORAGE_KEYS.settings, settings);
}
