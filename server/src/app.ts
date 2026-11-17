import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketServer } from 'socket.io';
import type { ClientToServerEvents, HealthResponse, ServerToClientEvents } from '@blindtest/shared';
import type { Catalogue } from './catalogue/Catalogue';
import type { Config } from './config';
import { GameManager } from './game/GameManager';
import { playerEmitter, registerSocketHandlers, type SocketData } from './game/socketHandlers';
import { MediaRegistry } from './media/MediaRegistry';
import { playerChannel, playerIdFromKey } from './players';
import { RoomManager } from './rooms/RoomManager';
import { registerCatalogueRoutes } from './routes/catalogue';
import { registerMediaRoutes } from './routes/media';

export type IoServer = SocketServer<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

export interface App {
  fastify: FastifyInstance;
  io: IoServer;
  media: MediaRegistry;
  games: GameManager;
  rooms: RoomManager;
}

export interface AppOptions {
  logger?: boolean;
  /** Catalogue chargé, ou `null` si la base n'a pas encore été générée. */
  catalogue?: Catalogue | null;
}

/** Fréquence de nettoyage des rooms vides. */
const ROOM_SWEEP_INTERVAL_MS = 60_000;

/** Construit l'application sans la démarrer (utilisable dans les tests). */
export async function buildApp(config: Config, options: AppOptions = {}): Promise<App> {
  const catalogue = options.catalogue ?? null;
  const fastify = Fastify({
    logger: options.logger ?? true,
  });

  await fastify.register(cors, { origin: [...config.clientOrigins] });

  fastify.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    version: config.version,
    uptimeSeconds: Math.round(process.uptime()),
    catalogueVersion: catalogue?.version ?? null,
  }));

  const media = new MediaRegistry();
  registerCatalogueRoutes(fastify, catalogue);
  registerMediaRoutes(fastify, media);

  const io: IoServer = new SocketServer(fastify.server, {
    cors: { origin: [...config.clientOrigins] },
  });
  const emitter = playerEmitter(io);
  const games = new GameManager(catalogue, media, emitter);
  const rooms = new RoomManager(games, emitter, Math.random, { catalogue, media });
  const sweeper = setInterval(() => rooms.sweep(), ROOM_SWEEP_INTERVAL_MS);
  sweeper.unref();

  // Identité stable : dérivée de la clé secrète envoyée par le navigateur.
  io.use((socket, next) => {
    socket.data.playerId = playerIdFromKey(socket.handshake.auth?.playerKey);
    next();
  });

  io.on('connection', (socket) => {
    const { playerId } = socket.data;
    void socket.join(playerChannel(playerId));
    socket.emit('welcome', { serverTime: Date.now(), playerId });
    socket.on('clock:ping', (ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });
    registerSocketHandlers(socket, { games, rooms });
  });

  fastify.addHook('onClose', async () => {
    clearInterval(sweeper);
    rooms.closeAll();
    games.closeAll();
    await io.close();
  });

  return { fastify, io, media, games, rooms };
}
