import { useSyncExternalStore } from 'react';
import type { GameSession, SessionState } from './GameSession';

/** État d'une session de jeu, mis à jour à chaque événement du serveur. */
export function useGameSession(session: GameSession): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState);
}
