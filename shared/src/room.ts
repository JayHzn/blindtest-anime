import type { GameSettings } from './game';
import type { PickingState } from './playlist';

export const ROOM_MAX_PLAYERS = 8;
/** Lettres sans ambiguïté à l'oral ou à l'écrit (pas de I, O). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;
/** Écran d'intro au lancement (mode, manches, joueurs, puis 3-2-1) : les chansons 1 et 2 se chargent. */
export const ROOM_INTRO_MS = 5000;
/** Attente maximale d'un retardataire ; il démarre ensuite dès que son son est prêt, avec son propre chrono. */
export const ROOM_AUDIO_WAIT_MS = 3000;

export interface RoomMember {
  id: string;
  pseudo: string;
  connected: boolean;
  isHost: boolean;
  /** A cliqué « Je suis prêt » (ce qui débloque le son dans son navigateur). */
  ready: boolean;
}

export interface RoomState {
  code: string;
  /** Identifiant du joueur qui reçoit l'état. */
  you: string;
  hostId: string;
  members: RoomMember[];
  settings: GameSettings;
  /** `lobby` : salon d'attente ; `picking` : choix des chansons (Playlist) ; `playing` : partie en cours. */
  status: 'lobby' | 'picking' | 'playing';
  /** Playlist : phase de choix en cours. */
  picking?: PickingState;
}

export type RoomError =
  | 'not_found'
  | 'full'
  | 'not_host'
  | 'not_in_room'
  | 'already_playing'
  | 'players_not_ready'
  | 'not_enough_players'
  | 'catalogue_unavailable'
  | 'not_enough_themes'
  | 'invalid_settings';

export type RoomResponse = { ok: true; room: RoomState } | { ok: false; error: RoomError };

/** « ab-cd » → « ABCD » ; `null` si ce n'est pas un code valide. */
export function normalizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  return [...code].every((letter) => ROOM_CODE_ALPHABET.includes(letter)) ? code : null;
}
