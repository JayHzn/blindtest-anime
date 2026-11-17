import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@blindtest/shared';
import { SERVER_URL } from './server';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Connexion temps réel unique, ouverte à la demande. */
export const socket: GameSocket = io(SERVER_URL || undefined, {
  autoConnect: false,
  transports: ['websocket'],
});

const CONNECT_TIMEOUT_MS = 15_000;

/** Ouvre la connexion si besoin et attend qu'elle soit établie. */
export function ensureConnected(): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('connection_timeout'));
    }, CONNECT_TIMEOUT_MS);
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      socket.off('connect', onConnect);
    };
    socket.on('connect', onConnect);
    socket.connect();
  });
}
