import { describe, expect, it } from 'vitest';
import { ROOM_MAX_PLAYERS, type RoomResponse, type RoomState } from '@blindtest/shared';
import type { GameEmitter } from '../src/game/Game';
import { GameManager } from '../src/game/GameManager';
import { MediaRegistry } from '../src/media/MediaRegistry';
import { EMPTY_ROOM_TTL_MS, RoomManager } from '../src/rooms/RoomManager';
import { buildFixtureCatalogue } from './fixtures/sources';

const catalogue = buildFixtureCatalogue();

function setup() {
  const events: { to: string; event: string; payload: unknown }[] = [];
  const emitter: GameEmitter = {
    toPlayer: (to, event, ...args) => events.push({ to, event, payload: args[0] }),
  };
  const games = new GameManager(catalogue, new MediaRegistry(), emitter);
  const rooms = new RoomManager(games, emitter);
  const lastState = (to: string) =>
    events.filter((e) => e.to === to && e.event === 'room:state').at(-1)?.payload as RoomState;
  const received = (to: string, event: string) =>
    events.filter((e) => e.to === to && e.event === event);
  const create = () => {
    const response = rooms.create('alice', 'Alice') as Extract<RoomResponse, { ok: true }>;
    return response.room.code;
  };
  return { rooms, games, events, lastState, received, create };
}

describe('RoomManager', () => {
  it('crée une room avec un code de 4 lettres et son hôte', () => {
    const t = setup();
    const response = t.rooms.create('alice', 'Alice');
    expect(response.ok).toBe(true);
    const { room } = response as Extract<RoomResponse, { ok: true }>;
    expect(room.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(room).toMatchObject({ hostId: 'alice', you: 'alice', status: 'lobby' });
  });

  it('rejoint par code (casse et tirets ignorés) et prévient les autres', () => {
    const t = setup();
    const code = t.create();
    const response = t.rooms.join(
      `${code.slice(0, 2).toLowerCase()}-${code.slice(2)}`,
      'bob',
      'Bob',
    );
    expect(response.ok).toBe(true);
    expect(t.lastState('alice').members.map((m) => m.pseudo)).toEqual(['Alice', 'Bob']);
    expect(t.rooms.join('ZZZZ', 'chloe', 'Chloé')).toEqual({ ok: false, error: 'not_found' });
  });

  it('distingue les pseudos identiques et limite à 8 joueurs', () => {
    const t = setup();
    const code = t.create();
    t.rooms.join(code, 'alice-2', 'alice');
    expect(t.lastState('alice').members[1]?.pseudo).toBe('alice 2');
    for (let i = 3; i <= ROOM_MAX_PLAYERS; i++) t.rooms.join(code, `p${i}`, `Joueur ${i}`);
    expect(t.rooms.join(code, 'p9', 'Joueur 9')).toEqual({ ok: false, error: 'full' });
  });

  it("seul l'hôte change les réglages et lance la partie", () => {
    const t = setup();
    const code = t.create();
    t.rooms.join(code, 'bob', 'Bob');
    t.rooms.updateSettings('bob', { mode: 'progressive', rounds: 5 });
    expect(t.lastState('alice').settings.mode).toBe('classic');
    t.rooms.updateSettings('alice', {
      mode: 'progressive',
      rounds: 5,
      filters: { popularity: 'all', types: ['OP', 'ED'] },
    });
    expect(t.lastState('bob').settings).toMatchObject({ mode: 'progressive', rounds: 5 });

    expect(t.rooms.start('bob')).toEqual({ ok: false, error: 'not_host' });
    // Bob n'a pas cliqué « Je suis prêt ».
    expect(t.rooms.start('alice')).toEqual({ ok: false, error: 'players_not_ready' });
    t.rooms.setReady('bob', true);
    expect(t.lastState('alice').members.every((m) => m.ready)).toBe(true);
    expect(t.rooms.start('alice')).toEqual({ ok: true });
    expect(t.lastState('bob').status).toBe('playing');
    // Les chansons 1 et 2 sont envoyées dès le lancement.
    expect(t.received('bob', 'round:prepare')).toHaveLength(2);
    expect(t.rooms.start('alice')).toEqual({ ok: false, error: 'already_playing' });
  });

  it('fait rejoindre la partie en cours et revient au salon à la fin', async () => {
    const t = setup();
    const code = t.create();
    t.rooms.updateSettings('alice', { rounds: 5, filters: { popularity: 'all', types: ['OP'] } });
    t.rooms.start('alice');
    t.rooms.join(code, 'bob', 'Bob');
    // L'état de la partie part juste après la réponse à room:join.
    expect(t.received('bob', 'game:state')).toHaveLength(0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(t.received('bob', 'game:state')).toHaveLength(1);

    t.games.gameOf('alice')!.close();
    expect(t.lastState('alice').status).toBe('lobby');
    expect(t.lastState('bob').status).toBe('lobby');
  });

  it("transmet le rôle d'hôte et supprime la room quand le dernier part", () => {
    const t = setup();
    const code = t.create();
    t.rooms.join(code, 'bob', 'Bob');
    t.rooms.leave('alice');
    expect(t.lastState('bob').hostId).toBe('bob');
    t.rooms.leave('bob');
    expect(t.rooms.size).toBe(0);
  });

  it('garde une room sans joueur connecté 10 minutes', () => {
    const t = setup();
    const code = t.create();
    t.rooms.join(code, 'bob', 'Bob');
    t.rooms.disconnect('alice');
    expect(t.lastState('bob').hostId).toBe('bob');
    t.rooms.disconnect('bob');
    const now = Date.now();
    t.rooms.sweep(now + EMPTY_ROOM_TTL_MS - 1000);
    expect(t.rooms.size).toBe(1);

    // Retour d'Alice : la room est à nouveau active.
    expect(t.rooms.join(code, 'alice', 'Alice').ok).toBe(true);
    t.rooms.sweep(now + EMPTY_ROOM_TTL_MS * 2);
    expect(t.rooms.size).toBe(1);

    t.rooms.disconnect('alice');
    t.rooms.sweep(Date.now() + EMPTY_ROOM_TTL_MS);
    expect(t.rooms.size).toBe(0);
    // Les membres (déconnectés) sont prévenus s'ils reviennent sur ce canal.
    expect(t.received('bob', 'room:closed')).toHaveLength(1);
  });
});
