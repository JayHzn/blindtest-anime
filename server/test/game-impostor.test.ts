import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  IMPOSTOR,
  MODE_TIMINGS,
  checkWord,
  titleWordsOf,
  type GameEnd,
  type ImpostorView,
  type PlayerScore,
  type RoundAudio,
  type RoundReveal,
} from '@blindtest/shared';
import { buildCatalogueData } from '../scripts/sync/map';
import { Catalogue } from '../src/catalogue/Catalogue';
import { Game, type GameEmitter } from '../src/game/Game';
import { GameManager } from '../src/game/GameManager';
import { MediaRegistry } from '../src/media/MediaRegistry';
import { sources } from './fixtures/sources';

const { countdownMs, revealMs } = MODE_TIMINGS.impostor;
/** Catalogue des fixtures (sans SQLite : seule la logique de jeu compte ici). */
const catalogue = new Catalogue(buildCatalogueData(sources));
const PLAYERS = ['alice', 'bob', 'chloe', 'dan'];
const VOTE_MS = 20_000;

interface Emitted {
  to: string;
  event: string;
  payload: unknown;
}

/**
 * Partie à 4, une manche : les civils ont Shingeki no Kyojin OP1, l'imposteur One Piece OP1.
 */
function setup({ rounds = 1, players = PLAYERS } = {}) {
  const events: Emitted[] = [];
  const emitter: GameEmitter = {
    toPlayer: (to, event, ...args) => events.push({ to, event, payload: args[0] }),
  };
  const civil = [1001, 3001, 1011];
  const impostor = [2001, 5001, 2001];
  const game = new Game({
    settings: { ...DEFAULT_SETTINGS, mode: 'impostor', rounds, voteMs: VOTE_MS },
    catalogue,
    media: new MediaRegistry(),
    emitter,
    themes: civil.slice(0, rounds).map((id) => catalogue.getTheme(id)!),
    impostorThemes: impostor.slice(0, rounds).map((id) => catalogue.getTheme(id)!),
  });
  for (const id of players) game.addPlayer(id, id[0]!.toUpperCase() + id.slice(1));

  const received = (to: string, event: string) =>
    events.filter((e) => e.to === to && e.event === event).map((e) => e.payload);
  const view = (to: string) =>
    (received(to, 'impostor:state').at(-1) as { view: ImpostorView } | undefined)?.view;
  const audioOf = (to: string, round = 0) =>
    (received(to, 'round:prepare') as RoundAudio[]).filter((a) => a.round === round).at(-1)!;
  /** Démarre la partie et passe l'écoute : premier joueur à donner son mot. */
  const toWords = () => {
    game.start();
    for (const id of players) game.audioReady(id, 0, audioOf(id).url);
    vi.advanceTimersByTime(countdownMs);
    const v = view(players[0]!)!;
    expect(v.step).toBe('listening');
    vi.advanceTimersByTime(v.stepEndsAt - Date.now());
    expect(view(players[0]!)!.step).toBe('words');
  };
  /** Chacun donne un mot (« motN »), dans l'ordre de passage. */
  const allWords = () => {
    let n = 0;
    while (view(players[0]!)!.step === 'words') {
      const v = view(players[0]!)!;
      const speaker = v.order[v.turn]!;
      expect(game.impostorWord(speaker, `mot${v.tour}x${n++}`)).toEqual({ ok: true });
      vi.advanceTimersByTime(0);
    }
    expect(view(players[0]!)!.step).toBe('voting');
  };
  const impostorId = () => {
    const urls = players.map((id) => audioOf(id).url);
    return players.find((_, i) => urls.filter((u) => u === urls[i]).length === 1)!;
  };
  const scores = () =>
    Object.fromEntries(
      (game.snapshot(players[0]!).players as PlayerScore[]).map((p) => [p.id, p.score]),
    );
  const lastReveal = () => received(players[0]!, 'round:reveal').at(-1) as RoundReveal;
  return { game, received, view, audioOf, toWords, allWords, impostorId, scores, lastReveal };
}

describe('Imposteur — mots', () => {
  it('refuse un mot du titre, un mot déjà donné, ou plusieurs mots', () => {
    const title = titleWordsOf(['Naruto Shippuden']);
    expect(checkWord('naruto', title, new Set())).toEqual({ ok: false, reason: 'title' });
    expect(checkWord('Narutō-kun', title, new Set())).toEqual({ ok: false, reason: 'title' });
    expect(checkWord('ninja rouge', title, new Set())).toEqual({ ok: false, reason: 'invalid' });
    expect(checkWord('Énergie', title, new Set(['energie']))).toEqual({
      ok: false,
      reason: 'used',
    });
    expect(checkWord('  ninja ', title, new Set())).toEqual({
      ok: true,
      word: 'ninja',
      key: 'ninja',
    });
    // Les mots très courts du titre (« no ») restent permis.
    expect(checkWord('no', titleWordsOf(['Shingeki no Kyojin']), new Set()).ok).toBe(true);
  });
});

describe('Game — mode Imposteur', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("chacun reçoit l'audio et le titre de sa chanson ; un seul imposteur à 4", () => {
    const t = setup();
    t.toWords();
    const impostor = t.impostorId();
    expect(impostor).toBeDefined();
    const civil = PLAYERS.find((id) => id !== impostor)!;
    expect(t.view(impostor)!.song?.title.en).toBe('One Piece');
    expect(t.view(civil)!.song?.title.en).toBe('Attack on Titan');
    expect(t.view(civil)!.impostorCount).toBe(1);
    // Rien ne trahit l'autre chanson ni le rôle des autres.
    expect(JSON.stringify(t.game.snapshot(civil))).not.toContain('One Piece');
    expect(JSON.stringify(t.view(impostor))).not.toContain('Attack on Titan');
  });

  it('refuse un mot hors de son tour, puis passe au suivant après 20 s sans mot', () => {
    const t = setup();
    t.toWords();
    const v = t.view('alice')!;
    const speaker = v.order[0]!;
    const other = v.order[1]!;
    expect(t.game.impostorWord(other, 'hors-tour')).toEqual({ ok: false, reason: 'not_your_turn' });
    vi.advanceTimersByTime(IMPOSTOR.wordMs);
    const after = t.view('alice')!;
    expect(after.turn).toBe(1);
    expect(after.words).toEqual([{ playerId: speaker, tour: 1, word: null }]);
  });

  it("refuse au civil un mot du titre de l'anime (toutes ses formes)", () => {
    const t = setup();
    t.toWords();
    const v = t.view('alice')!;
    const speaker = v.order[0]!;
    const word = speaker === t.impostorId() ? 'piece' : 'titans';
    expect(t.game.impostorWord(speaker, word)).toEqual({ ok: false, reason: 'title' });
  });

  it("vote unanime contre l'imposteur : les civils gagnent et devinent sa chanson", () => {
    const t = setup();
    t.toWords();
    t.allWords();
    const impostor = t.impostorId();
    const civils = PLAYERS.filter((id) => id !== impostor);
    // On voit qui a voté, jamais contre qui.
    t.game.impostorVote(civils[0]!, impostor);
    expect(t.view(civils[1]!)!.voters).toEqual([civils[0]]);
    expect(t.view(civils[1]!)!.yourVote).toBeNull();
    for (const id of civils.slice(1)) t.game.impostorVote(id, impostor);
    t.game.impostorVote(impostor, civils[0]!);
    vi.advanceTimersByTime(0);
    const elimination = t.view('alice')!;
    expect(elimination.step).toBe('elimination');
    expect(elimination.eliminations).toEqual([{ playerId: impostor, tour: 1, impostor: true }]);
    expect(elimination.tally[0]).toEqual({ playerId: impostor, votes: 3 });

    vi.advanceTimersByTime(IMPOSTOR.eliminationMs);
    expect(t.view('alice')!.step).toBe('guessing');
    expect(t.view('alice')!.winner).toBe('civils');
    // L'imposteur éliminé ne devine pas ; un civil trouve, un autre se trompe.
    expect(t.game.answer(impostor, { text: 'One Piece' }).accepted).toBe(false);
    expect(t.game.answer(civils[0]!, { text: 'One Piece' })).toMatchObject({ correct: true });
    expect(t.game.answer(civils[1]!, { text: 'Naruto' })).toMatchObject({ correct: false });
    expect(t.game.answer(civils[1]!, { text: 'One Piece' }).accepted).toBe(false);
    t.game.answer(civils[2]!, { text: 'Bleach' });
    vi.advanceTimersByTime(0);

    const reveal = t.lastReveal().impostor!;
    expect(reveal.winner).toBe('civils');
    expect(reveal.impostorSong.title.en).toBe('One Piece');
    expect(reveal.words).toHaveLength(4);
    expect(t.scores()).toMatchObject({
      [civils[0]!]: IMPOSTOR.civilWinPoints + IMPOSTOR.guessPoints,
      [civils[1]!]: IMPOSTOR.civilWinPoints,
      [impostor]: 0,
    });
    vi.advanceTimersByTime(revealMs);
    expect((t.received('alice', 'game:end').at(-1) as GameEnd).reason).toBe('completed');
  });

  it('fin du temps de vote : le plus voté est éliminé, même sans tous les votes', () => {
    const t = setup();
    t.toWords();
    t.allWords();
    const [a, b, c, d] = PLAYERS as [string, string, string, string];
    t.game.impostorVote(a, c);
    t.game.impostorVote(b, c);
    t.game.impostorVote(c, d);
    // d ne vote pas : à la fin des 20 s, c (2 voix) est éliminé.
    vi.advanceTimersByTime(VOTE_MS);
    expect(t.view(a)!.step).toBe('elimination');
    expect(t.view(a)!.lastEliminated).toBe(c);
  });

  it('2 voix contre 2 : revote ; nouvelle égalité, personne ; puis tour suivant', () => {
    const t = setup();
    t.toWords();
    t.allWords();
    const [a, b, c, d] = PLAYERS as [string, string, string, string];
    t.game.impostorVote(a, c);
    t.game.impostorVote(b, c);
    t.game.impostorVote(c, a);
    t.game.impostorVote(d, a);
    vi.advanceTimersByTime(0);
    const revote = t.view(b)!;
    expect(revote.step).toBe('revote');
    expect(revote.candidates.sort()).toEqual([a, c].sort());
    expect(t.game.impostorVote(a, c)).toBe(false); // ex æquo : ne vote pas
    expect(t.game.impostorVote(b, d)).toBe(false); // hors des ex æquo
    t.game.impostorVote(b, a);
    t.game.impostorVote(d, c);
    vi.advanceTimersByTime(0);
    expect(t.view(b)!.step).toBe('elimination');
    expect(t.view(b)!.lastEliminated).toBeNull();
    expect(t.view(b)!.alive).toHaveLength(4);
    vi.advanceTimersByTime(IMPOSTOR.eliminationMs);
    expect(t.view(b)!).toMatchObject({ step: 'words', tour: 2 });
  });

  it("l'imposteur gagne quand il reste autant d'imposteurs que de civils", () => {
    const t = setup();
    t.toWords();
    const impostor = t.impostorId();
    const civils = PLAYERS.filter((id) => id !== impostor);
    // Tour 1 : un civil éliminé ; tour 2 : un autre → 1 imposteur contre 1 civil.
    for (const victim of civils.slice(0, 2)) {
      t.allWords();
      for (const id of t.view('alice')!.alive) {
        if (id !== victim) t.game.impostorVote(id, victim);
        else t.game.impostorVote(id, impostor);
      }
      vi.advanceTimersByTime(0);
      expect(t.view('alice')!.eliminations.at(-1)).toMatchObject({
        playerId: victim,
        impostor: false,
      });
      vi.advanceTimersByTime(IMPOSTOR.eliminationMs);
    }
    const reveal = t.lastReveal().impostor!;
    expect(reveal.winner).toBe('impostors');
    expect(t.scores()[impostor]).toBe(IMPOSTOR.impostorWinPoints);
    expect(reveal.players.find((p) => p.playerId === civils[0])).toMatchObject({
      impostor: false,
      eliminatedAt: 1,
      points: 0,
    });
  });

  it('un joueur déconnecté à son tour est passé', () => {
    const t = setup();
    t.toWords();
    const speaker = t.view('alice')!.order[0]!;
    t.game.disconnect(speaker);
    vi.advanceTimersByTime(0);
    const v = t.view(PLAYERS.find((id) => id !== speaker)!)!;
    expect(v.words[0]).toEqual({ playerId: speaker, tour: 1, word: null });
    expect(v.turn).toBe(1);
  });
});

describe('GameManager — Imposteur', () => {
  it('demande 4 joueurs et tire des paires de chansons du même type', () => {
    const manager = new GameManager(catalogue, new MediaRegistry(), { toPlayer: () => {} });
    const settings = {
      ...DEFAULT_SETTINGS,
      mode: 'impostor',
      filters: { popularity: 'all', types: ['OP'] },
    };
    expect(
      manager.create({ players: PLAYERS.slice(0, 3).map((id) => ({ id, pseudo: id })), settings })
        .ok,
    ).toBe(false);
    const pairs = catalogue.impostorPairs({ popularity: 'all', types: ['OP'] }, 3);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [civil, impostor] of pairs) {
      expect(civil.type).toBe(impostor.type);
      expect(catalogue.franchiseOfTheme(civil.id)).not.toBe(
        catalogue.franchiseOfTheme(impostor.id),
      );
    }
    const result = manager.create({ players: PLAYERS.map((id) => ({ id, pseudo: id })), settings });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.game.settings.voteMs).toBe(IMPOSTOR.voteDefaultMs);
      result.game.close();
    }
  });
});
