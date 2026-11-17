import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketServer } from 'socket.io';
import type { ClientToServerEvents, HealthResponse, ServerToClientEvents } from '@blindtest/shared';
import { MediaRegistry } from './media/MediaRegistry';
import type { Catalogue } from './catalogue/Catalogue';
import type { Config } from './config';
import { GameManager } from './game/GameManager';
import { registerGameHandlers, socketEmitter } from './game/socketHandlers';
import { registerMediaRoutes } from './routes/media';
import { registerCatalogueRoutes } from './routes/catalogue';

export type IoServer = SocketServer<ClientToServerEvents, ServerToClientEvents>;

export interface App {
  fastify: FastifyInstance;
  io: IoServer;
  media: MediaRegistry;
  games: GameManager;
}

export interface AppOptions {
  logger?: boolean;
  /** Catalogue chargé, ou `null` si la base n'a pas encore été générée. */
  catalogue?: Catalogue | null;
}

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
  const games = new GameManager(catalogue, media, (gameId) => socketEmitter(io, gameId));

  io.on('connection', (socket) => {
    socket.emit('welcome', { serverTime: Date.now() });
    socket.on('clock:ping', (ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });
    registerGameHandlers(socket, games);
  });

  fastify.addHook('onClose', async () => {
    games.closeAll();
    await io.close();
  });

  return { fastify, io, media, games };
}
