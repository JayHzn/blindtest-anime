/**
 * Contrat des événements Socket.IO entre le client et le serveur.
 * Toute la communication temps réel passe par ces deux interfaces :
 * le compilateur vérifie les deux côtés.
 *
 * Identité : le client se connecte avec `auth: { playerKey }` (clé secrète gardée
 * dans le navigateur) ; le serveur en déduit un identifiant de joueur stable, ce
 * qui permet de retrouver sa partie ou sa room après une coupure.
 */
import type { AuctionView } from './auction';
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
  TierProgress,
} from './game';
import type { PlaylistPickResponse, PlaylistPreview, PlaylistSongsResponse } from './playlist';
import type { RoomError, RoomResponse, RoomState } from './room';

export type StartGameResponse =
  { ok: true; snapshot: GameSnapshot } | { ok: false; error: StartGameError };

/** Événements émis par le serveur vers le client. */
export interface ServerToClientEvents {
  /** Message de bienvenue envoyé à la connexion (avec l'identifiant du joueur). */
  welcome: (payload: { serverTime: number; playerId: string }) => void;
  /** État complet de la partie (arrivée en cours de partie, reconnexion). */
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
    /** Playlist : le joueur a choisi cette chanson (il écoute sans répondre). */
    ownSong?: boolean;
  }) => void;
  /** Liste des joueurs mise à jour (arrivée, départ, déconnexion, retour). */
  'game:players': (players: PlayerScore[]) => void;
  /**
   * Un joueur a trouvé (sans révéler la réponse).
   * En Playlist, seuls les joueurs qui ont choisi la chanson le reçoivent.
   */
  'player:found': (payload: { playerId: string; players: PlayerScore[] }) => void;
  /** Playlist : nombre anonyme de joueurs qui ont trouvé. */
  'playlist:found': (payload: { found: number }) => void;
  /** Playlist : tout le monde a trouvé, il reste jusqu'à `endsAt` pour deviner qui a choisi la chanson. */
  'playlist:guessWindow': (payload: { endsAt: number }) => void;
  /** Enchères : état de la manche (annonces, ordre de passage, extrait programmé…) à chaque changement. */
  'auction:state': (payload: { round: number; view: AuctionView }) => void;
  /** Fin de la manche : réponse et résultats. */
  'round:reveal': (reveal: RoundReveal) => void;
  /** Fin de la partie. */
  'game:end': (end: GameEnd) => void;
  /** État de la room (membres, réglages, statut) à chaque changement. */
  'room:state': (room: RoomState) => void;
  /** Le joueur n'est plus dans la room (room supprimée…). */
  'room:closed': () => void;
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
  /** Mode Progressif : passer au palier suivant (extrait plus long, moins de points). */
  'game:nextTier': (ack: (progress: TierProgress | null) => void) => void;
  /** Mode Progressif : abandonner la manche au dernier palier (0 point). */
  'game:giveUp': (ack: (progress: TierProgress | null) => void) => void;
  /** Enchères : annonce secrète (index de `AUCTION.bidsMs`), modifiable jusqu'à la fin de l'annonce. */
  'auction:bid': (payload: { bid: number }, ack: (ok: boolean) => void) => void;
  /** Enchères : celui qui a la main réécoute l'extrait ; renvoie les réécoutes restantes (null : refusé). */
  'auction:replay': (ack: (left: number | null) => void) => void;
  /** Quitte la partie en cours (solo). */
  'game:leave': () => void;
  /** L'audio de la manche (`url` reçue dans `round:prepare`) est préchargé et prêt à jouer. */
  'audio:ready': (payload: { round: number; url: string }) => void;
  /** L'audio n'a pas pu être chargé : le serveur choisit une autre musique pour la manche. */
  'audio:failed': (payload: { round: number; url: string }) => void;

  /** Crée une room (le joueur en devient l'hôte). */
  'room:create': (payload: { pseudo: string }, ack: (response: RoomResponse) => void) => void;
  /** Rejoint une room par son code (ou y revient après une coupure). */
  'room:join': (
    payload: { code: string; pseudo: string },
    ack: (response: RoomResponse) => void,
  ) => void;
  /** Quitte la room. */
  'room:leave': () => void;
  /** « Je suis prêt » dans le salon (le clic débloque aussi le son du navigateur). */
  'room:ready': (ready: boolean) => void;
  /** L'hôte modifie les réglages de la prochaine partie. */
  'room:settings': (settings: GameSettings) => void;
  /** L'hôte lance la partie pour tous les joueurs connectés. */
  'room:start': (ack: (response: { ok: true } | { ok: false; error: RoomError }) => void) => void;

  /** Playlist : chansons d'un anime pour la phase de choix (jetons opaques). */
  'playlist:songs': (
    payload: { animeId: number },
    ack: (response: PlaylistSongsResponse) => void,
  ) => void;
  /** Playlist : ajoute une chanson à sa playlist. */
  'playlist:pick': (
    payload: { token: string },
    ack: (response: PlaylistPickResponse) => void,
  ) => void;
  /** Playlist : retire une chanson de sa playlist. */
  'playlist:unpick': (
    payload: { token: string },
    ack: (response: PlaylistPickResponse) => void,
  ) => void;
  /** Playlist : aperçu de 5 s d'une chanson (audio opaque). */
  'playlist:preview': (
    payload: { token: string },
    ack: (preview: PlaylistPreview | null) => void,
  ) => void;
  /** Playlist : « Devine qui l'a choisie » (`null` : personne, tirée au hasard). Un seul pari. */
  'game:guess': (payload: { target: string | null }, ack: (ok: boolean) => void) => void;
}
