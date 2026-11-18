import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MODE_TIMINGS,
  type GameSnapshot,
  type RoundAudio,
  type RoundReveal,
} from '@blindtest/shared';
import { ABANDON_GRACE_MS, Game, type GameEmitter } from '../src/game/Game';
import { MediaRegistry } from '../src/media/MediaRegistry';
import { buildFixtureCatalogue } from './fixtures/sources';

const { countdownMs, listenMs } = MODE_TIMINGS.classic;
const catalogue = buildFixtureCatalogue();

interface Emitted {
  to: string;
  event: string;
  payload: unknown;
}

/** Partie à deux joueurs (Alice, Bob) sur S3 OP1, One Piece OP1, Kimi no Na wa ED. */
function setup() {
  const media = new MediaRegistry();
  const events: Emitted[] = [];
  const emitter: GameEmitter = {
    toPlayer: (to, event, ...args) => events.push({ to, event, payload: args[0] }),
  };
  const game = new Game({
    settings: { ...DEFAULT_SETTINGS, rounds: 3 },
    catalogue,
    media,
    emitter,
    themes: [1011, 2001, 3001, 5001].map((id) => catalogue.getTheme(id)!),
    random: () => 0.5,
  });
  game.addPlayer('alice', 'Alice');
  game.addPlayer('bob', 'Bob');

  const received = (to: string, event: string) =>
    events.filter((e) => e.to === to && e.event === event).map((e) => e.payload);
  const prepared = (round: number) =>
    (received('alice', 'round:prepare') as RoundAudio[]).filter((a) => a.round === round).at(-1)!;
  const readyAll = (round: number, ids = ['alice', 'bob']) => {
    for (const id of ids) game.audioReady(id, round, prepared(round).url);
  };
  /** Démarre et place la partie en écoute de la première manche. */
  const listen = () => {
    game.start();
    readyAll(0);
    vi.advanceTimersByTime(countdownMs);
    expect(game.currentPhase).toBe('listening');
  };
  return { game, events, received, prepared, readyAll, listen };
}

describe('Game — plusieurs joueurs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('envoie chaque événement à chaque joueur', () => {
    const t = setup();
    t.listen();
    expect(t.received('alice', 'round:start')).toHaveLength(1);
    expect(t.received('bob', 'round:start')).toHaveLength(1);
  });

  it("attend l'audio de tous les joueurs avant l'écoute", () => {
    const t = setup();
    t.game.start();
    t.readyAll(0, ['alice']);
    vi.advanceTimersByTime(countdownMs);
    expect(t.game.currentPhase).toBe('countdown');
    t.readyAll(0, ['bob']);
    expect(t.game.currentPhase).toBe('listening');
  });

  it('chacun marque selon sa rapidité ; révélation quand tout le monde a trouvé', () => {
    const t = setup();
    t.listen();
    vi.advanceTimersByTime(1500);
    expect(t.game.answer('alice', { text: 'snk' })).toMatchObject({ correct: true, points: 185 });
    vi.advanceTimersByTime(0);
    expect(t.game.currentPhase).toBe('listening');
    // Bob voit qu'Alice a trouvé, sans la réponse.
    const found = t.received('bob', 'player:found').at(-1) as { playerId: string };
    expect(found.playerId).toBe('alice');
    // Alice a trouvé : elle seule reçoit le lien de la vidéo, à précharger.
    expect(t.received('alice', 'round:video')).toEqual([
      { round: 0, url: 'https://v.animethemes.moe/S3-OP1.webm' },
    ]);
    expect(t.received('bob', 'round:video')).toEqual([]);

    vi.advanceTimersByTime(6000);
    expect(t.game.answer('bob', { text: 'snk' })).toMatchObject({ correct: true, points: 125 });
    vi.advanceTimersByTime(0);
    const reveal = t.received('bob', 'round:reveal').at(-1) as RoundReveal;
    expect(reveal.players.map((p) => [p.pseudo, p.score])).toEqual([
      ['Alice', 185],
      ['Bob', 125],
    ]);
  });

  it("un joueur qui arrive en cours d'écoute reçoit l'état et l'audio", () => {
    const t = setup();
    t.listen();
    t.game.addPlayer('chloe', 'Chloé');
    const snapshot = t.received('chloe', 'game:state').at(-1) as GameSnapshot;
    expect(snapshot).toMatchObject({ phase: 'listening', round: 0 });
    // Arrivé en cours de manche : il jouera à partir de la suivante.
    expect(snapshot.listenStartedAt).toBeNull();
    // La vidéo n'arrive qu'avec la révélation (lien direct).
    expect(snapshot.videoUrl).toBeNull();
    const rounds = (t.received('chloe', 'round:prepare') as RoundAudio[]).map((a) => a.round);
    expect(rounds).toEqual([0, 1]);
  });

  it("n'attend pas un joueur déconnecté, qui récupère tout en revenant", () => {
    const t = setup();
    t.listen();
    t.game.disconnect('bob');
    // Alice voit tout de suite Bob déconnecté.
    const players = t.received('alice', 'game:players').at(-1) as {
      pseudo: string;
      connected: boolean;
    }[];
    expect(players.find((p) => p.pseudo === 'Bob')?.connected).toBe(false);
    t.game.answer('alice', { text: 'snk' });
    vi.advanceTimersByTime(0);
    expect(t.game.currentPhase).toBe('reveal');

    t.game.reconnect('bob');
    expect((t.received('bob', 'game:state').at(-1) as GameSnapshot).phase).toBe('reveal');
    expect(t.received('bob', 'round:reveal').length).toBeGreaterThan(0);
  });

  it('un retardataire démarre avec son propre chrono, sans pénalité', () => {
    const t = setup();
    t.game.start();
    t.readyAll(0, ['alice']);
    vi.advanceTimersByTime(countdownMs + 10_000);
    expect(t.received('alice', 'round:start')).toHaveLength(1);
    expect(t.received('bob', 'round:start')).toHaveLength(0);
    // Bob refusé tant qu'il n'a pas démarré.
    expect(t.game.answer('bob', { text: 'snk' })).toEqual({
      accepted: false,
      reason: 'not_listening',
    });

    vi.advanceTimersByTime(5000);
    t.readyAll(0, ['bob']);
    expect(t.received('bob', 'round:start')).toHaveLength(1);
    // Fin du temps d'Alice : elle ne peut plus répondre, la manche continue pour Bob.
    vi.advanceTimersByTime(listenMs - 5000 + 1);
    expect(t.game.answer('alice', { text: 'snk' })).toMatchObject({ accepted: false });
    expect(t.game.currentPhase).toBe('listening');
    // Bob répond 12 s après SON départ : barème calculé sur son propre chrono.
    vi.advanceTimersByTime(2000);
    expect(t.game.answer('bob', { text: 'snk' })).toMatchObject({ correct: true, points: 80 });
  });

  it('arrête la partie si tout le monde reste déconnecté', () => {
    const t = setup();
    t.listen();
    t.game.disconnect('alice');
    t.game.disconnect('bob');
    vi.advanceTimersByTime(ABANDON_GRACE_MS - 1000);
    t.game.reconnect('alice');
    vi.advanceTimersByTime(listenMs);
    expect(t.game.isClosed).toBe(false);

    t.game.disconnect('alice');
    vi.advanceTimersByTime(ABANDON_GRACE_MS);
    expect(t.game.isClosed).toBe(true);
  });
});
