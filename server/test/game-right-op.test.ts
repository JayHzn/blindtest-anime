import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MODE_TIMINGS,
  RIGHT_OP_LISTEN_MS,
  rightOpAudioKey,
  type PlayerScore,
  type RightOpView,
  type RoundAudio,
  type RoundReveal,
} from '@blindtest/shared';
import { buildCatalogueData } from '../scripts/sync/map';
import { Catalogue } from '../src/catalogue/Catalogue';
import type { CatalogueData } from '../src/catalogue/types';
import { AUDIO_WAIT_MS, Game, type GameEmitter } from '../src/game/Game';
import { MediaRegistry } from '../src/media/MediaRegistry';
import { sources } from './fixtures/sources';

const { countdownMs, listenMs, revealMs } = MODE_TIMINGS.rightOp;
const catalogue = new Catalogue(buildCatalogueData(sources));

interface Emitted {
  to: string;
  event: string;
  payload: unknown;
}

/**
 * Partie « Le bon OP » : manche 1 = Shingeki no Kyojin OP1 parmi One Piece OP1,
 * Bakemonogatari OP1 et S3 OP1 (le moteur ne vérifie pas les pièges). Avec un
 * hasard fixé à 0,5, la chanson à trouver reste en première position (index 0).
 */
function setup(players = ['alice', 'bob'], rounds = 2) {
  const events: Emitted[] = [];
  const emitter: GameEmitter = {
    toPlayer: (to, event, ...args) => events.push({ to, event, payload: args[0] }),
  };
  const theme = (id: number) => catalogue.getTheme(id)!;
  const game = new Game({
    settings: { ...DEFAULT_SETTINGS, mode: 'rightOp', rounds },
    catalogue,
    media: new MediaRegistry(),
    emitter,
    // Deux manches, plus une de rechange.
    themes: [theme(1001), theme(2001), theme(5011)],
    rightOpTraps: [
      [theme(2001), theme(5001), theme(1011)],
      [theme(1001), theme(5001), theme(1012)],
      [theme(1001), theme(2001), theme(1011)],
    ],
    random: () => 0.5,
  });
  for (const id of players) game.addPlayer(id, id);

  const received = (to: string, event: string) =>
    events.filter((e) => e.to === to && e.event === event).map((e) => e.payload);
  const audio = (to: string, key: number) =>
    (received(to, 'round:prepare') as RoundAudio[]).filter((a) => a.round === key).at(-1)!;
  const view = (to: string) =>
    (received(to, 'rightOp:state').at(-1) as { view: RightOpView } | undefined)?.view;
  /** Chaque joueur signale les 4 extraits de la manche chargés. */
  const ready = (round: number) => {
    for (const id of players) {
      for (let slot = 0; slot < 4; slot++) {
        const key = rightOpAudioKey(round, slot);
        game.audioReady(id, key, audio(id, key).url);
      }
    }
  };
  const lastReveal = () =>
    events.filter((e) => e.event === 'round:reveal').at(-1)?.payload as RoundReveal | undefined;
  return { game, events, received, audio, view, ready, lastReveal };
}

describe('Game — Le bon OP', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('envoie 4 extraits opaques par manche, et l’anime dès le compte à rebours', () => {
    const t = setup();
    t.game.start();
    const urls = [0, 1, 2, 3].map((slot) => t.audio('alice', rightOpAudioKey(0, slot)).url);
    expect(new Set(urls).size).toBe(4);
    for (const url of urls) expect(url).toMatch(/^\/api\/audio\/[\w-]+$/);
    // La manche suivante se précharge déjà (écran d'intro).
    expect(t.audio('alice', rightOpAudioKey(1, 0))).toBeDefined();
    expect(t.view('alice')).toMatchObject({
      anime: { title: { en: 'Attack on Titan' }, type: 'OP' },
      answered: [],
      yourPick: null,
      yourResult: null,
    });
  });

  it('attend les 4 extraits de chacun avant de lancer la manche', () => {
    const t = setup(['alice']);
    t.game.start();
    for (let slot = 0; slot < 3; slot++) {
      const key = rightOpAudioKey(0, slot);
      t.game.audioReady('alice', key, t.audio('alice', key).url);
    }
    vi.advanceTimersByTime(countdownMs);
    expect(t.received('alice', 'round:start')).toHaveLength(0);
    const last = rightOpAudioKey(0, 3);
    t.game.audioReady('alice', last, t.audio('alice', last).url);
    expect(t.received('alice', 'round:start')).toHaveLength(1);
  });

  it('un extrait trop lent ne bloque pas le joueur : il démarre après l’attente', () => {
    const t = setup(['alice']);
    t.game.start();
    // Seuls 2 extraits sur 4 sont chargés.
    for (let slot = 0; slot < 2; slot++) {
      const key = rightOpAudioKey(0, slot);
      t.game.audioReady('alice', key, t.audio('alice', key).url);
    }
    vi.advanceTimersByTime(countdownMs);
    expect(t.received('alice', 'round:start')).toHaveLength(0);
    vi.advanceTimersByTime(AUDIO_WAIT_MS);
    expect(t.received('alice', 'round:start')).toHaveLength(1);
    expect(t.game.pickRightOp('alice', 0)).toMatchObject({ correct: true });
  });

  it('un seul essai ; résultat au joueur seul ; scores à la révélation', () => {
    const t = setup();
    t.game.start();
    t.ready(0);
    vi.advanceTimersByTime(countdownMs + 3000);
    // Vidéo préchargée dès le départ : l'anime est affiché, elle ne dit pas quel extrait est le bon.
    expect(t.received('alice', 'round:video')).toHaveLength(1);

    // Pendant l'écoute des 4 extraits : 200 points.
    expect(t.game.pickRightOp('alice', 0)).toEqual({ correct: true, points: 200 });
    expect(t.game.pickRightOp('alice', 1)).toBeNull();
    // Les autres voient qu'Alice a répondu, pas si elle a juste, et son score ne bouge pas.
    expect(t.view('bob')!.answered).toEqual(['alice']);
    expect(t.view('bob')!.yourResult).toBeNull();
    const players = t.received('bob', 'game:players').at(-1) as PlayerScore[];
    expect(players.find((p) => p.id === 'alice')).toMatchObject({ score: 0, found: true });

    // Bob se trompe : tout le monde a répondu, révélation tout de suite.
    expect(t.game.pickRightOp('bob', 2)).toEqual({ correct: false, points: 0 });
    vi.advanceTimersByTime(0);
    const reveal = t.lastReveal()!;
    expect(reveal.rightOp?.answer).toBe(0);
    expect(reveal.rightOp?.options).toHaveLength(4);
    expect(reveal.rightOp?.options[0]).toMatchObject({ correct: true, song: expect.any(String) });
    expect(reveal.rightOp?.options.filter((o) => o.correct)).toHaveLength(1);
    expect(reveal.rightOp?.picks).toEqual(
      expect.arrayContaining([
        { playerId: 'alice', index: 0 },
        { playerId: 'bob', index: 2 },
      ]),
    );
    expect(reveal.players.find((p) => p.id === 'alice')).toMatchObject({ score: 200, found: true });
    // À la révélation, la coche dit qui a trouvé (Bob a répondu, mais faux).
    expect(reveal.players.find((p) => p.id === 'bob')).toMatchObject({ score: 0, found: false });
    expect(reveal.video).toBeTruthy();
    // Pas de récapitulatif « ta réponse » ni de bonus de précision dans ce mode.
    expect(reveal.bonuses).toBeUndefined();
  });

  it('pendant le décompte, les points baissent de 200 à 50', () => {
    const t = setup(['alice']);
    t.game.start();
    t.ready(0);
    vi.advanceTimersByTime(countdownMs + RIGHT_OP_LISTEN_MS + 7500);
    expect(t.game.pickRightOp('alice', 0)).toEqual({ correct: true, points: 125 });
  });

  it('sans réponse, la manche se termine après les 31 s', () => {
    const t = setup(['alice']);
    t.game.start();
    t.ready(0);
    vi.advanceTimersByTime(countdownMs + listenMs - 100);
    expect(t.lastReveal()).toBeUndefined();
    vi.advanceTimersByTime(200);
    expect(t.lastReveal()?.rightOp?.picks).toEqual([]);
    vi.advanceTimersByTime(revealMs);
    expect(t.view('alice')!.anime.title.en).toBe('One Piece');
  });

  it('un extrait injouable avant la manche : la manche est remplacée', () => {
    const t = setup(['alice'], 1);
    t.game.start();
    const key = rightOpAudioKey(0, 1);
    const before = t.audio('alice', key).url;
    t.game.audioFailed('alice', key, before);
    expect(t.audio('alice', key).url).not.toBe(before);
    // Une seule manche jouée : la première remplaçante est One Piece.
    expect(t.view('alice')!.anime.title.en).toBe('One Piece');
  });

  it('refuse un choix hors manche ou hors limites', () => {
    const t = setup(['alice']);
    t.game.start();
    expect(t.game.pickRightOp('alice', 0)).toBeNull();
    t.ready(0);
    vi.advanceTimersByTime(countdownMs + 1000);
    expect(t.game.pickRightOp('alice', 4)).toBeNull();
    expect(t.game.pickRightOp('zoe', 0)).toBeNull();
  });
});

/** Petit catalogue : 8 séries d'OP et un ED, années et popularités variées. */
function syntheticCatalogue(): Catalogue {
  const rows = [
    { id: 1, year: 2011, popularity: 600_000, genre: 'Psychological' },
    { id: 2, year: 2012, popularity: 360_000, genre: 'Psychological' },
    { id: 3, year: 2009, popularity: 350_000, genre: 'Psychological' },
    { id: 4, year: 2011, popularity: 440_000, genre: 'Shounen' },
    { id: 5, year: 2013, popularity: 500_000, genre: 'Shounen' },
    { id: 6, year: 1998, popularity: 480_000, genre: 'Seinen' },
    { id: 7, year: 2022, popularity: 90_000, genre: 'Comedy' },
    { id: 8, year: 2010, popularity: 700_000, genre: 'Psychological' },
  ];
  const data: CatalogueData = {
    generatedAt: '2026-11-18T00:00:00Z',
    franchises: rows.map((r) => ({
      id: r.id,
      seriesId: null,
      name: `Serie ${r.id}`,
      nameFr: null,
    })),
    anime: rows.map((r) => ({
      id: r.id,
      slug: `anime-${r.id}`,
      franchiseId: r.id,
      name: `Anime ${r.id}`,
      titleRomaji: null,
      titleEn: null,
      titleFr: null,
      year: r.year,
      season: null,
      mediaFormat: 'TV',
      anilistId: r.id,
      malId: null,
      popularity: r.popularity,
      popularityRank: r.id,
      coverUrl: null,
      coverColor: null,
      genre: r.genre,
    })),
    themes: [
      ...rows.map((r) => ({
        id: r.id * 10,
        animeId: r.id,
        type: 'OP' as const,
        sequence: 1,
        slug: 'OP1',
        songTitle: `Song ${r.id}`,
        artists: null,
        audioUrl: `https://a.example/${r.id}.ogg`,
        videoUrl: null,
        videoResolution: null,
        spoiler: false,
      })),
      {
        id: 11,
        animeId: 1,
        type: 'ED' as const,
        sequence: 1,
        slug: 'ED1',
        songTitle: 'Ending 1',
        artists: null,
        audioUrl: 'https://a.example/ed.ogg',
        videoUrl: null,
        videoResolution: null,
        spoiler: false,
      },
    ],
    titles: [],
  };
  return new Catalogue(data);
}

describe('Catalogue.rightOpRounds', () => {
  const synthetic = syntheticCatalogue();
  const all = { popularity: 'all' as const, types: ['OP' as const, 'ED' as const] };
  const franchiseOf = (themeId: number) => synthetic.franchiseOfTheme(themeId)!;

  it('3 pièges du même type, chacun d’une autre série', () => {
    for (let seed = 1; seed < 20; seed++) {
      let state = seed;
      const random = () => (state = (state * 9301 + 49297) % 233280) / 233280;
      const rounds = synthetic.rightOpRounds(all, 1, random);
      expect(rounds).toHaveLength(1);
      const { target, traps } = rounds[0]!;
      expect(traps).toHaveLength(3);
      for (const trap of traps) expect(trap.type).toBe(target.type);
      const franchises = new Set([target, ...traps].map((t) => franchiseOf(t.id)));
      expect(franchises.size).toBe(4);
    }
  });

  it('préfère les séries proches (époque, popularité, genre)', () => {
    // La série 1 (2011, Psychological) : ses pièges les plus proches sont 2, 3, 4, 5 ou 8,
    // jamais la 6 (1998) ni la 7 (popularité ×6,7), tant qu'il y en a assez de proches.
    const random = () => 0;
    const rounds = synthetic.rightOpRounds({ ...all, types: ['OP'] }, 8, random);
    const withTarget1 = rounds.find((r) => franchiseOf(r.target.id) === 1);
    if (withTarget1) {
      for (const trap of withTarget1.traps) expect([6, 7]).not.toContain(franchiseOf(trap.id));
    }
  });

  it('jamais deux fois la même série dans la partie', () => {
    const rounds = synthetic.rightOpRounds(all, 5, () => 0.3);
    const seen = rounds.flatMap((r) => [r.target, ...r.traps].map((t) => franchiseOf(t.id)));
    expect(new Set(seen).size).toBe(seen.length);
    // 8 séries : au plus 2 manches de 4.
    expect(rounds.length).toBeLessThanOrEqual(2);
  });
});
