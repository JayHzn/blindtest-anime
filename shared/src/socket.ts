/**
 * Contrat des événements Socket.IO entre le client et le serveur.
 * Toute la communication temps réel passe par ces deux interfaces :
 * le compilateur vérifie les deux côtés.
 */

/** Événements émis par le serveur vers le client. */
export interface ServerToClientEvents {
  /** Message de bienvenue envoyé à la connexion. */
  welcome: (payload: { serverTime: number }) => void;
}

/** Événements émis par le client vers le serveur. */
export interface ClientToServerEvents {
  /** Mesure de latence / synchro d'horloge : le serveur répond avec son heure. */
  'clock:ping': (ack: (serverTime: number) => void) => void;
}
