import { storage, STORAGE_KEYS } from './storage';

/**
 * Clé secrète du joueur, gardée dans le navigateur. Le serveur en déduit un
 * identifiant stable : après une coupure ou un rechargement, on retrouve sa
 * room, sa partie et son score.
 */
export function getPlayerKey(): string {
  const saved = storage.get(STORAGE_KEYS.playerKey);
  if (saved && /^[\w-]{16,128}$/.test(saved)) return saved;
  const key = crypto.randomUUID();
  storage.set(STORAGE_KEYS.playerKey, key);
  return key;
}
