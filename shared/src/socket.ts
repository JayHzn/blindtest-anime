/**
 * Contrat des événements Socket.IO entre le client et le serveur.
 * Toute la communication temps réel passe par ces deux interfaces :
 * le compilateur vérifie les deux côtés.
 */
import type { AnswerPayload } from './catalogue';
import type {
  AnswerResult,
  GameEnd,
  GameSettings,
  GameSnapshot,
  PlayerScore,
  RoundAudio,
  RoundReveal,
  StartGameError,
} from './game';

export type StartGameResponse =
  { ok: true; snapshot: GameSnapshot } | { ok: false; error: StartGameError };

/** Événements émis par le serveur vers le client. */
export interface ServerToClientEvents {
  /** Message de bienvenue envoyé à la connexion. */
  welcome: (payload: { serverTime: number }) => void;
  /** État complet de la partie. */
  'game:state': (snapshot: GameSnapshot) => void;
  /** Audio d'une manche à précharger (envoyé à l'avance). */
  'round:prepare': (audio: RoundAudio) => void;
  /** Compte à rebours avant l'écoute. */
  'round:countdown': (payload: { round: number; phaseEndsAt: number }) => void;
  /**
   * Début de l'écoute : lancer l'extrait à `startedAt` (heure serveur).
   * `videoUrl` (opaque) permet de précharger la vidéo de la révélation.
   */
  'round:start': (payload: {
    round: number;
    startedAt: number;
    phaseEndsAt: number;
    videoUrl: string | null;
  }) => void;
  /** Un joueur a trouvé (sans révéler la réponse). */
  'player:found': (payload: { playerId: string; players: PlayerScore[] }) => void;
  /** Fin de la manche : réponse et résultats. */
  'round:reveal': (reveal: RoundReveal) => void;
  /** Fin de la partie. */
  'game:end': (end: GameEnd) => void;
}

/** Événements émis par le client vers le serveur. */
export interface ClientToServerEvents {
  /** Mesure de latence / synchro d'horloge : le serveur répond avec son heure. */
  'clock:ping': (ack: (serverTime: number) => void) => void;
  /** Lance une partie solo. */
  'game:start': (
    payload: { pseudo: string; settings: GameSettings },
    ack: (response: StartGameResponse) => void,
  ) => void;
  /** Envoie une réponse pendant l'écoute. */
  'game:answer': (answer: AnswerPayload, ack: (result: AnswerResult) => void) => void;
  /** Quitte la partie en cours. */
  'game:leave': () => void;
  /** L'audio de la manche (`url` reçue dans `round:prepare`) est préchargé et prêt à jouer. */
  'audio:ready': (payload: { round: number; url: string }) => void;
  /** L'audio n'a pas pu être chargé : le serveur choisit une autre musique pour la manche. */
  'audio:failed': (payload: { round: number; url: string }) => void;
}
