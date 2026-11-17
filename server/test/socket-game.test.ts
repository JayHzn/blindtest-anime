import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import {
  DEFAULT_SETTINGS,
  type ClientToServerEvents,
  type RoundAudio,
  type ServerToClientEvents,
  type StartGameResponse,
} from '@blindtest/shared';
import { buildApp, type App } from '../src/app';
import { config } from '../src/config';
import { buildFixtureCatalogue } from './fixtures/sources';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const once = <E extends keyof ServerToClientEvents>(socket: ClientSocket, event: E) =>
  new Promise<Parameters<ServerToClientEvents[E]>[0]>((resolve) => {
    (socket.once as (e: string, cb: (payload: never) => void) => void)(event, resolve);
  });

describe('partie solo via Socket.IO', () => {
  let app: App;
  let socket: ClientSocket;
  let playerId: string;

  beforeAll(async () => {
    app = await buildApp(config, { logger: false, catalogue: buildFixtureCatalogue() });
    const address = await app.fastify.listen({ port: 0, host: '127.0.0.1' });
    socket = connect(address, {
      transports: ['websocket'],
      auth: { playerKey: 'cle-secrete-de-test-alice-0001' },
    });
    ({ playerId } = await once(socket, 'welcome'));
  });

  afterAll(async () => {
    socket.disconnect();
    await app.fastify.close();
  });

  it('démarre une partie, envoie l’audio puis le compte à rebours', async () => {
    const prepare = once(socket, 'round:prepare');
    const countdown = once(socket, 'round:countdown');
    const response = await socket.emitWithAck('game:start', {
      pseudo: '  Alice  ',
      settings: { ...DEFAULT_SETTINGS, rounds: 5, filters: { popularity: 'all', types: ['OP'] } },
    });

    expect(response.ok).toBe(true);
    const { snapshot } = response as Extract<StartGameResponse, { ok: true }>;
    expect(snapshot.players).toEqual([
      { id: playerId, pseudo: 'Alice', score: 0, found: false, connected: true },
    ]);
    // Le catalogue d'exemple n'a que 4 franchises avec des OP : partie raccourcie.
    expect(snapshot.totalRounds).toBe(3);

    const audio: RoundAudio = await prepare;
    expect(audio.round).toBe(0);
    expect((await countdown).round).toBe(0);
    expect(app.games.activeGames).toBe(1);

    // L'URL envoyée au client est opaque : aucun nom de fichier ni domaine de la source.
    expect(audio.url).not.toMatch(/animethemes|\.ogg/);
  });

  it('refuse une réponse hors écoute, puis libère la partie en quittant', async () => {
    const result = await socket.emitWithAck('game:answer', { text: 'snk' });
    expect(result).toEqual({ accepted: false, reason: 'not_listening' });
    socket.emit('game:leave');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.games.activeGames).toBe(0);
  });

  it('signale un catalogue introuvable', async () => {
    const empty = await buildApp(config, { logger: false });
    const address = await empty.fastify.listen({ port: 0, host: '127.0.0.1' });
    const other: ClientSocket = connect(address, { transports: ['websocket'] });
    const response = await other.emitWithAck('game:start', {
      pseudo: 'Bob',
      settings: DEFAULT_SETTINGS,
    });
    expect(response).toEqual({ ok: false, error: 'catalogue_unavailable' });
    other.disconnect();
    await empty.fastify.close();
  });
});
