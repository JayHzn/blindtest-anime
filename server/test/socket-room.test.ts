import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  GameSnapshot,
  RoomResponse,
  RoomState,
  ServerToClientEvents,
} from '@blindtest/shared';
import { buildApp, type App } from '../src/app';
import { config } from '../src/config';
import { buildFixtureCatalogue } from './fixtures/sources';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const once = <E extends keyof ServerToClientEvents>(socket: ClientSocket, event: E) =>
  new Promise<Parameters<ServerToClientEvents[E]>[0]>((resolve) => {
    (socket.once as (e: string, cb: (payload: never) => void) => void)(event, resolve);
  });

/** Attend un `room:state` qui vérifie la condition. */
const roomStateWhere = (socket: ClientSocket, check: (room: RoomState) => boolean) =>
  new Promise<RoomState>((resolve) => {
    const listener = (room: RoomState) => {
      if (!check(room)) return;
      socket.off('room:state', listener);
      resolve(room);
    };
    socket.on('room:state', listener);
  });

describe('room multijoueur via Socket.IO', () => {
  let app: App;
  let address: string;
  const sockets: ClientSocket[] = [];

  const client = async (playerKey: string) => {
    const socket: ClientSocket = connect(address, {
      transports: ['websocket'],
      auth: { playerKey },
    });
    sockets.push(socket);
    await once(socket, 'welcome');
    return socket;
  };

  beforeAll(async () => {
    app = await buildApp(config, { logger: false, catalogue: buildFixtureCatalogue() });
    address = await app.fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await app.fastify.close();
  });

  it('crée, rejoint, lance, et retrouve sa place après une coupure', async () => {
    const alice = await client('cle-secrete-alice-0000000001');
    const created = (await alice.emitWithAck('room:create', { pseudo: 'Alice' })) as Extract<
      RoomResponse,
      { ok: true }
    >;
    expect(created.ok).toBe(true);
    const { code } = created.room;

    const bob = await client('cle-secrete-bob-00000000000001');
    const aliceSeesBob = roomStateWhere(alice, (room) => room.members.length === 2);
    const joined = await bob.emitWithAck('room:join', { code, pseudo: 'Bob' });
    expect(joined.ok).toBe(true);
    expect((await aliceSeesBob).members.map((m) => m.pseudo)).toEqual(['Alice', 'Bob']);

    alice.emit('room:settings', {
      mode: 'classic',
      rounds: 5,
      filters: { popularity: 'all', types: ['OP', 'ED'] },
    });
    const aliceSeesBobReady = roomStateWhere(alice, (room) =>
      room.members.every((m) => m.ready || m.isHost),
    );
    bob.emit('room:ready', true);
    await aliceSeesBobReady;
    const bobPlaying = roomStateWhere(bob, (room) => room.status === 'playing');
    const bobPrepare = once(bob, 'round:prepare');
    expect(await alice.emitWithAck('room:start')).toEqual({ ok: true });
    await bobPlaying;
    expect((await bobPrepare).round).toBe(0);

    // Coupure de Bob : Alice le voit déconnecté…
    const aliceSeesBobGone = roomStateWhere(alice, (room) =>
      room.members.some((m) => m.pseudo === 'Bob' && !m.connected),
    );
    bob.disconnect();
    await aliceSeesBobGone;

    // … puis il revient avec la même clé : room et partie renvoyées automatiquement.
    const reconnecting: ClientSocket = connect(address, {
      transports: ['websocket'],
      auth: { playerKey: 'cle-secrete-bob-00000000000001' },
    });
    sockets.push(reconnecting);
    const roomBack = once(reconnecting, 'room:state');
    const gameBack = once(reconnecting, 'game:state');
    expect((await roomBack).status).toBe('playing');
    const snapshot: GameSnapshot = await gameBack;
    expect(snapshot.players.map((p) => p.pseudo).sort()).toEqual(['Alice', 'Bob']);
  });
});
