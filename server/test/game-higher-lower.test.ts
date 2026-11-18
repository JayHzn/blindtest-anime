import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  HIGHER_LOWER,
  MODE_TIMINGS,
  inRatioWindow,
  popularityRatio,
  ratioWindow,
  type GameEnd,
  type GameSnapshot,
  type PlayerScore,
  type RoundAudio,
  type RoundReveal,
} from '@blindtest/shared';
import { buildCatalogueData } from '../scripts/sync/map';
import { Catalogue } from '../src/catalogue/Catalogue';
import type { AnimeRow, CatalogueData, ThemeRow } from '../src/catalogue/types';
import { Game, type GameEmitter } from '../src/game/Game';
import { GameManager } from '../src/game/GameManager';
import { MediaRegistry } from '../src/media/MediaRegistry';
import { sources } from './fixtures/sources';

const { countdownMs, revealMs } = MODE_TIMINGS.higherLower;
const { snippetMs, chooseMs } = HIGHER_LOWER;
/** Catalogue des fixtures (sans passer par SQLite : seule la logique de jeu compte ici). */
const catalogue = new Catalogue(buildCatalogueData(sources));
const settings = { ...DEFAULT_SETTINGS, mode: 'higherLower' as const };

/**
 * Chaîne imposée : Kimi no Na wa (800 000) → SnK (1 000 000) → SnK S3 (600 000)
 * → One Piece (900 000). Tour 1 : plus ; tour 2 : moins ; tour 3 : plus.
 */
const CHAIN = [3001, 1001, 1011, 2001];

interface Emitted {
  to: string;
  event: string;
  payload: unknown;
}

function setup(players: string[]) {
  const events: Emitted[] = [];
  const emitter: GameEmitter = {
    toPlayer: (to, event, ...args) => events.push({ to, event, payload: args[0] }),
  };
  const game = new Game({
    settings,
    catalogue,
    media: new MediaRegistry(),
    emitter,
    themes: CHAIN.map((id) => catalogue.getTheme(id)!),
    random: () => 0.5,
  });
  for (const id of players) game.addPlayer(id, id[0]!.toUpperCase() + id.slice(1));

  const received = (to: string, event: string) =>
    events.filter((e) => e.to === to && e.event === event).map((e) => e.payload);
  const prepared = (round: number) =>
    (received(players[0]!, 'round:prepare') as RoundAudio[])
      .filter((a) => a.round === round)
      .at(-1)!;
  const ready = (round: number, ids = players) => {
    for (const id of ids) game.audioReady(id, round, prepared(round).url);
  };
  const lastReveal = () => received(players[0]!, 'round:reveal').at(-1) as RoundReveal;
  const scores = () => game.snapshot(players[0]!).players;
  /** Démarre la partie et lance l'écoute du tour 1 (A puis B). */
  const firstTour = () => {
    game.start();
    ready(0);
    ready(1);
    vi.advanceTimersByTime(countdownMs);
    expect(game.currentPhase).toBe('listening');
  };
  /** Révélation passée : compte à rebours puis écoute du tour suivant. */
  const nextTour = (tour: number) => {
    vi.advanceTimersByTime(revealMs);
    ready(tour);
    vi.advanceTimersByTime(countdownMs);
    expect(game.snapshot(players[0]!).round).toBe(tour);
    expect(game.currentPhase).toBe('listening');
  };
  return { game, received, ready, lastReveal, scores, firstTour, nextTour };
}

describe('Catalogue — chaîne Plus ou moins', () => {
  /** 60 animes (60 franchises) de 1 000 à ~4 400 000 membres (×1,15 à chaque fois), et un sans popularité. */
  function syntheticCatalogue(): Catalogue {
    const anime: AnimeRow[] = [];
    const themes: ThemeRow[] = [];
    for (let i = 0; i <= 60; i++) {
      const popularity = i === 60 ? 0 : Math.round(1000 * 1.15 ** i);
      anime.push({
        id: i + 1,
        slug: `a${i}`,
        franchiseId: i + 1,
        name: `Anime ${i}`,
        titleRomaji: null,
        titleEn: null,
        titleFr: null,
        year: 2010,
        season: null,
        mediaFormat: 'TV',
        anilistId: i + 1,
        malId: null,
        popularity,
        popularityRank: 61 - i,
        coverUrl: null,
        coverColor: null,
        genre: null,
      });
      themes.push({
        id: 1000 + i,
        animeId: i + 1,
        type: 'OP',
        sequence: 1,
        slug: 'OP1',
        songTitle: null,
        artists: null,
        audioUrl: `https://a.example/${i}.ogg`,
        videoUrl: null,
        videoResolution: null,
        spoiler: false,
      });
    }
    const data: CatalogueData = {
      generatedAt: '2026-11-18T00:00:00.000Z',
      franchises: anime.map((a) => ({
        id: a.franchiseId,
        seriesId: null,
        name: a.name,
        nameFr: null,
      })),
      anime,
      themes,
      titles: [],
    };
    return new Catalogue(data);
  }

  it("respecte l'écart de chaque tour, sans franchise répétée ni anime sans popularité", () => {
    const synthetic = syntheticCatalogue();
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const chain = synthetic.higherLowerChain(
      { popularity: 'all', types: ['OP'] },
      HIGHER_LOWER.maxTours + 1,
      random,
    );
    expect(chain).toHaveLength(HIGHER_LOWER.maxTours + 1);
    const popularity = (theme: ThemeRow) => synthetic.getAnime(theme.animeId)!.popularity;
    expect(new Set(chain.map((theme) => theme.animeId)).size).toBe(chain.length);
    expect(chain.every((theme) => popularity(theme) > 0)).toBe(true);
    let inWindow = 0;
    for (let tour = 1; tour < chain.length; tour++) {
      const ratio = popularityRatio(popularity(chain[tour - 1]!), popularity(chain[tour]!));
      expect(ratio).toBeGreaterThanOrEqual(HIGHER_LOWER.minRatio);
      if (inRatioWindow(ratio, ratioWindow(tour))) inWindow++;
    }
    // Repli (écart le plus proche) seulement si aucune chanson ne convient.
    expect(inWindow).toBeGreaterThanOrEqual(chain.length - 3);
  });

  it('garde le début de chaîne et exclut les franchises demandées', () => {
    const synthetic = syntheticCatalogue();
    const prefix = [synthetic.getTheme(1010)!, synthetic.getTheme(1013)!];
    const chain = synthetic.higherLowerChain(
      { popularity: 'all', types: ['OP'] },
      6,
      Math.random,
      prefix,
      new Set([20]),
    );
    expect(chain.slice(0, 2)).toEqual(prefix);
    expect(chain.some((theme) => theme.animeId === 20)).toBe(false);
  });
});

describe('Game — mode Plus ou moins', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('prépare A, B et la chanson suivante, et attend les deux sons du tour 1', () => {
    const t = setup(['alice']);
    t.game.start();
    expect((t.received('alice', 'round:prepare') as RoundAudio[]).map((a) => a.round)).toEqual([
      0, 1, 2,
    ]);
    expect(t.game.totalRounds).toBe(CHAIN.length - 1);
    // Seul B est prêt : l'écoute attend A.
    t.ready(1);
    vi.advanceTimersByTime(countdownMs);
    expect(t.game.currentPhase).toBe('countdown');
    t.ready(0);
    expect(t.game.currentPhase).toBe('listening');
    const start = t.received('alice', 'round:start').at(-1) as {
      round: number;
      phaseEndsAt: number;
      startedAt: number;
      videoUrl: string | null;
      higherLower: GameSnapshot['higherLower'];
    };
    expect(start.round).toBe(1);
    // Tour 1 : A (10 s), B (10 s), puis 10 s pour choisir ; pas de vidéo.
    expect(start.phaseEndsAt - start.startedAt).toBe(2 * snippetMs + chooseMs);
    expect(start.videoUrl).toBeNull();
    expect(start.higherLower).toMatchObject({ tour: 1, reference: null, yourPick: null });
  });

  it("le choix s'ouvre quand B commence, il est définitif, et la bonne réponse rapporte 1", () => {
    const t = setup(['alice']);
    t.firstTour();
    expect(t.game.pick('alice', 'higher')).toBe(false); // A joue encore
    vi.advanceTimersByTime(snippetMs);
    expect(t.game.pick('alice', 'higher')).toBe(true);
    expect(t.game.pick('alice', 'lower')).toBe(false);
    // Tout le monde a choisi : révélation tout de suite.
    vi.advanceTimersByTime(0);
    expect(t.game.currentPhase).toBe('reveal');
    const reveal = t.lastReveal().higherLower!;
    expect(reveal).toMatchObject({
      tour: 1,
      answer: 'higher',
      ratio: 1.25,
      eliminated: [],
      allWrong: false,
      gameOver: false,
    });
    expect(reveal.reference.popularity).toBe(800_000);
    expect(reveal.challenger.popularity).toBe(1_000_000);
    expect(t.scores()[0]!.score).toBe(1);
  });

  it('au tour 2, la chanson du tour 1 devient la référence affichée', () => {
    const t = setup(['alice']);
    t.firstTour();
    vi.advanceTimersByTime(snippetMs);
    t.game.pick('alice', 'higher');
    t.nextTour(2);
    const view = t.game.snapshot('alice').higherLower!;
    expect(view.tour).toBe(2);
    expect(view.reference?.popularity).toBe(1_000_000);
    expect(view.window).toEqual(ratioWindow(2));
    // La référence (chanson 1) reste disponible pour la réécoute.
    expect(t.game.pick('alice', 'lower')).toBe(true);
  });

  it('solo : une erreur termine la série', () => {
    const t = setup(['alice']);
    t.firstTour();
    vi.advanceTimersByTime(snippetMs);
    t.game.pick('alice', 'lower');
    vi.advanceTimersByTime(0);
    const reveal = t.lastReveal().higherLower!;
    expect(reveal.eliminated).toEqual(['alice']);
    expect(reveal.gameOver).toBe(true);
    vi.advanceTimersByTime(revealMs);
    const end = t.received('alice', 'game:end').at(-1) as GameEnd;
    expect(end.reason).toBe('completed');
    expect(end.players[0]).toMatchObject({ score: 0, eliminatedAt: 1 });
  });

  it("pas de réponse à temps : c'est une erreur", () => {
    const t = setup(['alice']);
    t.firstTour();
    vi.advanceTimersByTime(2 * snippetMs + chooseMs);
    const reveal = t.lastReveal().higherLower!;
    expect(reveal.picks).toEqual([{ playerId: 'alice', pick: null, correct: false }]);
    expect(reveal.gameOver).toBe(true);
  });

  it("multi : on voit qui a répondu, jamais quoi ; tous faux, personne n'est éliminé", () => {
    const t = setup(['alice', 'bob', 'chloe']);
    t.firstTour();
    vi.advanceTimersByTime(snippetMs);
    t.game.pick('alice', 'lower');
    const players = t.received('bob', 'player:found').at(-1) as { players: PlayerScore[] };
    expect(players.players.find((p) => p.id === 'alice')?.found).toBe(true);
    expect(JSON.stringify(t.game.snapshot('bob'))).not.toContain('lower');
    t.game.pick('bob', 'lower');
    t.game.pick('chloe', 'lower');
    vi.advanceTimersByTime(0);
    const reveal = t.lastReveal().higherLower!;
    expect(reveal.allWrong).toBe(true);
    expect(reveal.eliminated).toEqual([]);
    expect(reveal.gameOver).toBe(false);
  });

  it('multi : les éliminés regardent, le dernier en jeu gagne', () => {
    const t = setup(['alice', 'bob', 'chloe']);
    t.firstTour();
    vi.advanceTimersByTime(snippetMs);
    t.game.pick('alice', 'higher');
    t.game.pick('bob', 'higher');
    t.game.pick('chloe', 'lower');
    vi.advanceTimersByTime(0);
    expect(t.lastReveal().higherLower!.eliminated).toEqual(['chloe']);

    t.nextTour(2);
    // Chloé écoute en spectatrice, sans répondre.
    expect(t.received('chloe', 'round:start')).toHaveLength(2);
    expect(t.game.pick('chloe', 'lower')).toBe(false);
    t.game.pick('alice', 'lower');
    t.game.pick('bob', 'higher');
    vi.advanceTimersByTime(0);
    const reveal = t.lastReveal().higherLower!;
    expect(reveal.picks.map((p) => p.playerId)).toEqual(['alice', 'bob']);
    expect(reveal.eliminated).toEqual(['bob']);
    expect(reveal.gameOver).toBe(true);

    vi.advanceTimersByTime(revealMs);
    const end = t.received('alice', 'game:end').at(-1) as GameEnd;
    // Classement : encore en jeu, puis le plus tardif à être éliminé.
    expect(end.players.map((p) => [p.id, p.score, p.eliminatedAt])).toEqual([
      ['alice', 2, undefined],
      ['bob', 1, 2],
      ['chloe', 0, 1],
    ]);
  });

  it('un joueur arrivé en cours de partie regarde', () => {
    const t = setup(['alice', 'bob']);
    t.firstTour();
    t.game.addPlayer('dan', 'Dan');
    vi.advanceTimersByTime(snippetMs);
    expect(t.game.pick('dan', 'higher')).toBe(false);
    expect(t.game.snapshot('dan').players.find((p) => p.id === 'dan')?.eliminatedAt).toBe(0);
  });

  it('fin de la chaîne : les joueurs encore en jeu finissent ex æquo', () => {
    const t = setup(['alice', 'bob']);
    t.firstTour();
    const answers = ['higher', 'lower', 'higher'] as const;
    for (let tour = 1; tour <= 3; tour++) {
      if (tour > 1) t.nextTour(tour);
      if (tour === 1) vi.advanceTimersByTime(snippetMs);
      t.game.pick('alice', answers[tour - 1]!);
      t.game.pick('bob', answers[tour - 1]!);
      vi.advanceTimersByTime(0);
    }
    expect(t.lastReveal().higherLower!.gameOver).toBe(true);
    vi.advanceTimersByTime(revealMs);
    const end = t.received('alice', 'game:end').at(-1) as GameEnd;
    expect(end.players.map((p) => p.score)).toEqual([3, 3]);
  });

  it('un audio injouable est remplacé en retirant la suite de la chaîne', () => {
    const t = setup(['alice']);
    t.game.start();
    const before = (t.received('alice', 'round:prepare') as RoundAudio[]).find(
      (a) => a.round === 1,
    )!;
    t.game.audioFailed('alice', 1, before.url);
    // Fixtures : SnK écarté (son audio a échoué), One Piece prend sa place.
    const after = (t.received('alice', 'round:prepare') as RoundAudio[]).filter(
      (a) => a.round === 1,
    );
    expect(after.length).toBeGreaterThan(1);
    expect(after.at(-1)!.url).not.toBe(before.url);
  });
});

describe('GameManager — Plus ou moins', () => {
  it('se joue en solo, avec une chaîne tirée dans le catalogue', () => {
    const manager = new GameManager(catalogue, new MediaRegistry(), { toPlayer: () => {} });
    const result = manager.create({
      players: [{ id: 'alice', pseudo: 'Alice' }],
      settings: { ...settings, filters: { popularity: 'all', types: ['OP', 'ED'] } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Fixtures : 3 franchises avec une popularité AniList → 2 tours au plus.
    expect(result.game.totalRounds).toBe(2);
    result.game.close();
  });
});
