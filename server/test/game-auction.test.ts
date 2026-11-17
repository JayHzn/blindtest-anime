import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUCTION,
  DEFAULT_SETTINGS,
  MODE_TIMINGS,
  type AuctionView,
  type GameSnapshot,
  type PlayerScore,
  type RoundAudio,
  type RoundReveal,
} from '@blindtest/shared';
import { Game, type GameEmitter } from '../src/game/Game';
import { GameManager } from '../src/game/GameManager';
import { MediaRegistry } from '../src/media/MediaRegistry';
import { buildFixtureCatalogue } from './fixtures/sources';

const { countdownMs } = MODE_TIMINGS.auction;
const catalogue = buildFixtureCatalogue();
const PLAYERS = ['alice', 'bob', 'chloe'];

interface Emitted {
  to: string;
  event: string;
  payload: unknown;
}

/** Partie d'enchères à trois (Alice, Bob, Chloé) ; manche 1 : Shingeki no Kyojin S3 OP1 (2018). */
function setup({ audioWaitMs = 3000 } = {}) {
  const media = new MediaRegistry();
  const events: Emitted[] = [];
  const emitter: GameEmitter = {
    toPlayer: (to, event, ...args) => events.push({ to, event, payload: args[0] }),
  };
  const game = new Game({
    settings: { ...DEFAULT_SETTINGS, mode: 'auction', rounds: 3 },
    catalogue,
    media,
    emitter,
    themes: [1011, 2001, 3001, 5001].map((id) => catalogue.getTheme(id)!),
    random: () => 0.5,
    audioWaitMs,
  });
  for (const id of PLAYERS) game.addPlayer(id, id[0]!.toUpperCase() + id.slice(1));

  const received = (to: string, event: string) =>
    events.filter((e) => e.to === to && e.event === event).map((e) => e.payload);
  const view = (to: string) =>
    (received(to, 'auction:state').at(-1) as { view: AuctionView } | undefined)?.view;
  const score = (id: string) =>
    (received(id, 'game:players').at(-1) as PlayerScore[]).find((p) => p.id === id)!.score;
  const prepared = (round: number) =>
    (received('alice', 'round:prepare') as RoundAudio[]).filter((a) => a.round === round).at(-1)!;
  const readyAll = (round: number, ids = PLAYERS) => {
    for (const id of ids) game.audioReady(id, round, prepared(round).url);
  };
  /** Démarre la partie et ouvre l'annonce de la première manche. */
  const bidding = (ready = PLAYERS) => {
    game.start();
    readyAll(0, ready);
    vi.advanceTimersByTime(countdownMs);
    expect(game.currentPhase).toBe('bidding');
  };
  /** Avance jusqu'à la fin de l'extrait en cours (début du temps de réponse). */
  const toAnswering = () => {
    const snippet = view('alice')!.snippet!;
    vi.advanceTimersByTime(snippet.startsAt + snippet.durationMs - Date.now());
    expect(game.currentPhase).toBe('answering');
  };
  const lastReveal = () => received('alice', 'round:reveal').at(-1) as RoundReveal | undefined;
  return { game, events, received, view, score, readyAll, bidding, toAnswering, lastReveal };
}

describe('Game — mode Enchères', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ouvre l'annonce avec l'indice Type · Année · Genre, sans rien révéler d'autre", () => {
    const t = setup();
    t.bidding();
    const view = t.view('bob')!;
    expect(view.hint).toEqual({ type: 'OP', year: 2018, genre: 'Shounen' });
    expect(view.step).toBe('bidding');
    expect(view.biddingEndsAt - Date.now()).toBe(AUCTION.biddingMs);
    expect(view.participants).toEqual(PLAYERS);
    // La vidéo opaque se précharge ; la manche suivante aussi.
    expect(view.videoUrl).toMatch(/^\/api\/video\//);
    expect((t.received('bob', 'round:prepare') as RoundAudio[]).map((a) => a.round)).toEqual([
      0, 1,
    ]);
  });

  it('les annonces restent secrètes : on voit seulement qui a annoncé', () => {
    const t = setup();
    t.bidding();
    expect(t.game.bid('alice', 0)).toBe(true);
    const bobView = t.view('bob')!;
    expect(bobView.bidders).toEqual(['alice']);
    expect(bobView.yourBid).toBeNull();
    expect(bobView.order).toEqual([]);
    expect(t.view('alice')!.yourBid).toBe(0);
    // Snapshot (reconnexion) : même secret.
    expect(t.game.snapshot('bob').auction?.order).toEqual([]);
  });

  it("l'annonce la plus courte a la main ; à égalité, la première annoncée", () => {
    const t = setup();
    t.bidding();
    t.game.bid('chloe', 3);
    vi.advanceTimersByTime(100);
    t.game.bid('bob', 1);
    vi.advanceTimersByTime(100);
    t.game.bid('alice', 1);
    // Tout le monde a annoncé : l'annonce se termine sans attendre les 8 s.
    vi.advanceTimersByTime(0);
    const view = t.view('chloe')!;
    expect(view.step).toBe('listening');
    expect(view.order.map((turn) => [turn.playerId, turn.bid])).toEqual([
      ['bob', 1],
      ['alice', 1],
      ['chloe', 3],
    ]);
    expect(view.turn).toBe(0);
    // Extrait commun de 1 s, programmé après l'affichage de l'ordre de passage.
    expect(view.snippet).toMatchObject({ turn: 0, durationMs: 1000 });
    expect(view.snippet!.startsAt - Date.now()).toBe(AUCTION.orderRevealMs);
    expect(view.snippet!.answerEndsAt - view.snippet!.startsAt).toBe(1000 + AUCTION.answerMs);
  });

  it('changer d’avis refait l’horodatage (pas d’annonce prudente échangée au dernier moment)', () => {
    const t = setup();
    t.bidding();
    t.game.bid('alice', 4);
    vi.advanceTimersByTime(100);
    t.game.bid('bob', 0);
    vi.advanceTimersByTime(100);
    t.game.bid('alice', 0);
    t.game.bid('chloe', 2);
    vi.advanceTimersByTime(0);
    expect(t.view('alice')!.order.map((turn) => turn.playerId)).toEqual(['bob', 'alice', 'chloe']);
  });

  it('bonne réponse : points selon l’annonce, fin de manche', () => {
    const t = setup();
    t.bidding();
    t.game.bid('alice', 0);
    t.game.bid('bob', 2);
    t.game.bid('chloe', 4);
    vi.advanceTimersByTime(0);
    // Pas de réponse avant d'avoir entendu l'extrait.
    expect(t.game.answer('alice', { text: 'snk' })).toEqual({
      accepted: false,
      reason: 'not_listening',
    });
    vi.advanceTimersByTime(AUCTION.orderRevealMs);
    expect(t.game.answer('bob', { text: 'snk' })).toEqual({
      accepted: false,
      reason: 'not_your_turn',
    });
    expect(t.game.answer('alice', { text: 'snk' })).toMatchObject({ correct: true, points: 300 });
    vi.advanceTimersByTime(0);
    expect(t.game.currentPhase).toBe('reveal');
    const reveal = t.lastReveal()!;
    expect(reveal.results.find((r) => r.playerId === 'alice')).toMatchObject({
      correct: true,
      points: 300,
      auction: { bid: 0, status: 'found' },
    });
    expect(reveal.results.find((r) => r.playerId === 'bob')?.auction).toEqual({
      bid: 2,
      status: 'waiting',
    });
    expect(reveal.players[0]).toMatchObject({ id: 'alice', score: 300, found: true });
  });

  it('mauvaise réponse : pénalité, proposition montrée à tous, la main passe avec un extrait plus long', () => {
    const t = setup();
    t.bidding();
    t.game.bid('alice', 0);
    t.game.bid('bob', 1);
    t.game.bid('chloe', 4);
    vi.advanceTimersByTime(0);
    t.toAnswering();
    expect(t.game.answer('alice', { text: 'One Piece', pick: { kind: 'anime', id: 200 } })).toEqual(
      { accepted: true, correct: false, points: -150, seasonExact: false, sequenceExact: false },
    );
    // Un seul essai.
    expect(t.game.answer('alice', { text: 'snk' })).toMatchObject({ accepted: false });
    expect(t.score('alice')).toBe(-150);

    const view = t.view('chloe')!;
    expect(view.order[0]).toMatchObject({
      playerId: 'alice',
      status: 'wrong',
      guess: { fr: 'One Piece', en: 'One Piece' },
      points: -150,
    });
    expect(view.turn).toBe(1);
    expect(view.order[1]!.status).toBe('playing');
    expect(view.snippet).toMatchObject({ turn: 1, durationMs: 1000 });
    expect(view.snippet!.startsAt - Date.now()).toBe(AUCTION.turnGapMs);

    t.toAnswering();
    expect(t.game.answer('bob', { text: 'snk' })).toMatchObject({ correct: true, points: 250 });
    vi.advanceTimersByTime(0);
    expect(t.lastReveal()!.auction?.map((turn) => turn.status)).toEqual([
      'wrong',
      'found',
      'waiting',
    ]);
  });

  it('silence pendant 10 s : compte comme une erreur', () => {
    const t = setup();
    t.bidding();
    t.game.bid('alice', 2);
    t.game.bid('bob', 3);
    t.game.bid('chloe', 4);
    vi.advanceTimersByTime(0);
    t.toAnswering();
    vi.advanceTimersByTime(AUCTION.answerMs - 1);
    expect(t.view('bob')!.turn).toBe(0);
    vi.advanceTimersByTime(1);
    expect(t.view('bob')!.order[0]).toMatchObject({ status: 'silent', guess: null, points: -75 });
    expect(t.score('alice')).toBe(-75);
    expect(t.view('bob')!.turn).toBe(1);
  });

  it('tout le monde se trompe : révélation directe, pénalités conservées', () => {
    const t = setup();
    t.bidding();
    t.game.bid('alice', 0);
    t.game.bid('bob', 1);
    t.game.bid('chloe', 4);
    vi.advanceTimersByTime(0);
    for (const id of ['alice', 'bob', 'chloe']) {
      t.toAnswering();
      t.game.answer(id, { text: 'One Piece' });
    }
    expect(t.view('alice')!.step).toBe('done');
    vi.advanceTimersByTime(AUCTION.turnGapMs);
    expect(t.game.currentPhase).toBe('reveal');
    const reveal = t.lastReveal()!;
    expect(reveal.results.every((r) => !r.correct)).toBe(true);
    expect(reveal.players.map((p) => [p.id, p.score])).toEqual([
      ['chloe', -25],
      ['bob', -100],
      ['alice', -150],
    ]);
  });

  it("un joueur qui n'annonce rien ne joue pas la manche", () => {
    const t = setup();
    t.bidding();
    t.game.bid('alice', 4);
    t.game.bid('bob', 2);
    vi.advanceTimersByTime(AUCTION.biddingMs);
    const view = t.view('chloe')!;
    expect(view.order.map((turn) => turn.playerId)).toEqual(['bob', 'alice']);
    expect(t.game.answer('chloe', { text: 'snk' })).toMatchObject({ reason: 'not_your_turn' });
  });

  it('personne n’annonce : révélation directe', () => {
    const t = setup();
    t.bidding();
    vi.advanceTimersByTime(AUCTION.biddingMs);
    expect(t.game.currentPhase).toBe('reveal');
    expect(t.lastReveal()!.results.every((r) => r.points === 0 && r.auction?.bid === null)).toBe(
      true,
    );
  });

  it('celui qui a la main peut réécouter 3 fois, pendant son temps de réponse', () => {
    const t = setup();
    t.bidding();
    t.game.bid('alice', 0);
    t.game.bid('bob', 1);
    t.game.bid('chloe', 1);
    vi.advanceTimersByTime(0);
    expect(t.game.replay('alice')).toBeNull(); // extrait commun pas encore joué
    t.toAnswering();
    expect(t.game.replay('bob')).toBeNull();
    expect([1, 2, 3].map(() => t.game.replay('alice'))).toEqual([2, 1, 0]);
    expect(t.game.replay('alice')).toBeNull();
    expect(t.game.snapshot('alice').auction?.replaysLeft).toBe(0);
  });

  it('celui qui a la main se déconnecte : la main passe sans pénalité', () => {
    const t = setup();
    t.bidding();
    t.game.bid('alice', 0);
    t.game.bid('bob', 1);
    t.game.bid('chloe', 3);
    vi.advanceTimersByTime(0);
    t.toAnswering();
    t.game.disconnect('alice');
    const view = t.view('bob')!;
    expect(view.order[0]).toMatchObject({ status: 'skipped', points: 0 });
    expect(view.turn).toBe(1);
    expect(t.score('bob')).toBe(0);
    // À son retour, il retrouve l'état de la manche.
    t.game.reconnect('alice');
    const snapshot = t.received('alice', 'game:state').at(-1) as GameSnapshot;
    expect(snapshot.auction?.turn).toBe(1);
  });

  it("l'annonce se termine si le seul joueur sans annonce se déconnecte", () => {
    const t = setup();
    t.bidding();
    t.game.bid('alice', 1);
    t.game.bid('bob', 2);
    t.game.disconnect('chloe');
    vi.advanceTimersByTime(0);
    expect(t.view('alice')!.step).toBe('listening');
  });

  it("attend l'audio de celui qui a la main (au plus 3 s), puis lance l'extrait", () => {
    const t = setup();
    t.bidding(['alice', 'chloe']);
    t.game.bid('bob', 0);
    t.game.bid('alice', 1);
    t.game.bid('chloe', 2);
    vi.advanceTimersByTime(0);
    expect(t.view('alice')!.snippet).toBeNull();
    vi.advanceTimersByTime(1000);
    t.readyAll(0, ['bob']);
    const snippet = t.view('alice')!.snippet!;
    expect(snippet.turn).toBe(0);
    expect(snippet.startsAt - Date.now()).toBe(AUCTION.syncLeadMs);
  });

  it('enchaîne sur la manche suivante après la révélation', () => {
    const t = setup();
    t.bidding();
    vi.advanceTimersByTime(AUCTION.biddingMs + MODE_TIMINGS.auction.revealMs);
    expect(t.game.currentPhase).toBe('countdown');
    t.readyAll(1);
    vi.advanceTimersByTime(countdownMs);
    expect(t.game.currentPhase).toBe('bidding');
    expect(t.view('alice')!.hint).toEqual({ type: 'OP', year: 1999, genre: null });
  });
});

describe('GameManager — mode Enchères', () => {
  it('refuse une partie à un seul joueur', () => {
    const manager = new GameManager(catalogue, new MediaRegistry(), { toPlayer: () => {} });
    const solo = manager.create({
      players: [{ id: 'alice', pseudo: 'Alice' }],
      settings: { ...DEFAULT_SETTINGS, mode: 'auction' },
    });
    expect(solo).toEqual({ ok: false, error: 'invalid_settings' });
    const duo = manager.create({
      players: [
        { id: 'alice', pseudo: 'Alice' },
        { id: 'bob', pseudo: 'Bob' },
      ],
      settings: { ...DEFAULT_SETTINGS, mode: 'auction' },
    });
    expect(duo.ok).toBe(true);
    manager.closeAll();
  });
});
