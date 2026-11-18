import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MODE_TIMINGS,
  classicPoints,
  type GameModeId,
  type RoundAudio,
  type RoundReveal,
} from '@blindtest/shared';
import { MediaRegistry } from '../src/media/MediaRegistry';
import { AUDIO_WAIT_MS, Game, type GameEmitter } from '../src/game/Game';
import { buildFixtureCatalogue } from './fixtures/sources';

const { countdownMs, listenMs, revealMs } = MODE_TIMINGS.classic;
const catalogue = buildFixtureCatalogue();

/** S3 OP1 (L'Attaque des Titans), One Piece OP1, Kimi no Na wa ED, + 1 remplaçante. */
const THEME_IDS = [1011, 2001, 3001, 5001];

interface Emitted {
  to: string;
  event: string;
  payload: unknown;
}

function setup(themeIds = THEME_IDS, mode: GameModeId = 'classic') {
  const media = new MediaRegistry();
  const events: Emitted[] = [];
  const emitter: GameEmitter = {
    toPlayer: (to, event, ...args) => events.push({ to, event, payload: args[0] }),
  };
  const onFinished = vi.fn();
  const game = new Game({
    settings: { ...DEFAULT_SETTINGS, mode, rounds: 3 },
    catalogue,
    media,
    emitter,
    themes: themeIds.map((id) => catalogue.getTheme(id)!),
    random: () => 0.5,
    onFinished,
  });
  game.addPlayer('p1', 'Alice');

  const all = (event: string) => events.filter((e) => e.event === event).map((e) => e.payload);
  const last = <T>(event: string) => all(event).at(-1) as T;
  const prepared = (round: number) =>
    (all('round:prepare') as RoundAudio[]).filter((a) => a.round === round).at(-1)!;
  /** Le joueur signale que l'audio de la manche est chargé. */
  const ready = (round: number) => game.audioReady('p1', round, prepared(round).url);

  return { game, media, events, all, last, prepared, ready, onFinished };
}

describe('Game — mode Classique', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('déroule une manche : compte à rebours, écoute, bonne réponse, révélation', () => {
    const t = setup();
    t.game.start();
    expect(t.prepared(0).url).toMatch(/^\/api\/audio\/[\w-]+$/);
    expect(t.prepared(0).startRatio).toBe(0.3);
    expect(t.all('round:countdown')).toHaveLength(1);

    t.ready(0);
    vi.advanceTimersByTime(countdownMs);
    expect(t.all('round:start')).toHaveLength(1);
    // La vidéo de révélation se précharge pendant l'écoute, derrière une URL opaque.
    const { videoUrl } = t.last<{ videoUrl: string }>('round:start');
    expect(videoUrl).toMatch(/^\/api\/video\/[\w-]+$/);
    expect(t.media.resolve(videoUrl.split('/').pop()!, 'video')).toContain('S3-OP1');
    // L'audio de la manche suivante est envoyé pendant l'écoute.
    expect(t.prepared(1)).toBeDefined();

    vi.advanceTimersByTime(3000);
    const result = t.game.answer('p1', { text: 'Attack on Titan Season 3', sequence: 1 });
    expect(result).toEqual({
      accepted: true,
      correct: true,
      points: classicPoints(3000, listenMs) + 25 + 25,
      seasonExact: true,
      sequenceExact: true,
    });
    expect(t.all('player:found')).toHaveLength(1);

    // Solo : tout le monde a trouvé, la révélation arrive tout de suite.
    vi.advanceTimersByTime(0);
    const reveal = t.last<RoundReveal>('round:reveal');
    expect(reveal.anime.title.fr).toBe("L'Attaque des Titans — Saison 3");
    expect(reveal.anime).toMatchObject({
      coverUrl: 'https://img.anili.st/media/99147.jpg',
      coverColor: '#e4a15d',
    });
    expect(reveal.theme).toMatchObject({ type: 'OP', sequence: 1 });
    expect(reveal.results[0]).toMatchObject({ playerId: 'p1', correct: true, points: 220 });
    expect(reveal.players[0]?.score).toBe(220);
  });

  it('fixe un départ commun un peu dans le futur ; les points comptent depuis ce départ', () => {
    const events: Emitted[] = [];
    const game = new Game({
      settings: { ...DEFAULT_SETTINGS, mode: 'classic', rounds: 1 },
      catalogue,
      media: new MediaRegistry(),
      emitter: { toPlayer: (to, event, ...args) => events.push({ to, event, payload: args[0] }) },
      themes: [catalogue.getTheme(1011)!],
      listenLeadMs: 500,
    });
    game.addPlayer('p1', 'Alice');
    game.start();
    const audio = events.find((e) => e.event === 'round:prepare')!.payload as RoundAudio;
    game.audioReady('p1', 0, audio.url);
    vi.advanceTimersByTime(countdownMs);
    const start = events.find((e) => e.event === 'round:start')!.payload as {
      startedAt: number;
      phaseEndsAt: number;
    };
    // Le navigateur reçoit le départ avant l'heure et lance l'extrait pile à ce moment.
    expect(start.startedAt - Date.now()).toBe(500);
    expect(start.phaseEndsAt - start.startedAt).toBe(listenMs);
    vi.advanceTimersByTime(500 + 3000);
    expect(game.answer('p1', { text: 'Attack on Titan Season 3' })).toMatchObject({
      correct: true,
      points: classicPoints(3000, listenMs) + 25,
    });
  });

  it('pas de bonus de numéro pour un anime à un seul opening et un seul ending', () => {
    // SnK saison 1 : un seul OP et un seul ED (le numéro est forcément 1).
    expect(catalogue.validate(1001, { text: 'Shingeki no Kyojin', sequence: 1 })).toMatchObject({
      correct: true,
      sequenceExact: false,
    });
    // SnK saison 3 : OP1 et OP2, le numéro compte.
    expect(
      catalogue.validate(1011, { text: 'Attack on Titan Season 3', sequence: 1 }),
    ).toMatchObject({ correct: true, sequenceExact: true });
  });

  it("attend l'audio, puis le laisse démarrer dès qu'il est prêt, avec tout son temps", () => {
    const t = setup();
    t.game.start();
    vi.advanceTimersByTime(countdownMs);
    expect(t.all('round:start')).toHaveLength(0);
    vi.advanceTimersByTime(AUDIO_WAIT_MS);
    expect(t.game.currentPhase).toBe('listening');
    // Son toujours pas prêt : pas de départ pour lui.
    expect(t.all('round:start')).toHaveLength(0);
    vi.advanceTimersByTime(4000);
    t.ready(0);
    const start = t.last<{ startedAt: number; phaseEndsAt: number }>('round:start');
    expect(start.phaseEndsAt - start.startedAt).toBe(listenMs);
    // Son chrono démarre maintenant : la manche dure encore 15 s pour lui.
    vi.advanceTimersByTime(listenMs - 1);
    expect(t.game.currentPhase).toBe('listening');
    vi.advanceTimersByTime(1);
    expect(t.game.currentPhase).toBe('reveal');
  });

  it("démarre dès que l'audio arrive pendant l'attente", () => {
    const t = setup();
    t.game.start();
    vi.advanceTimersByTime(countdownMs + 1000);
    expect(t.all('round:start')).toHaveLength(0);
    t.ready(0);
    expect(t.all('round:start')).toHaveLength(1);
  });

  it('refuse les réponses hors écoute et après avoir trouvé', () => {
    const t = setup();
    t.game.start();
    expect(t.game.answer('p1', { text: 'snk' })).toEqual({
      accepted: false,
      reason: 'not_listening',
    });
    t.ready(0);
    vi.advanceTimersByTime(countdownMs);
    expect(t.game.answer('p1', { text: 'snk' })).toMatchObject({ correct: true });
    expect(t.game.answer('p1', { text: 'snk' })).toEqual({
      accepted: false,
      reason: 'already_found',
    });
    expect(t.game.answer('inconnu', { text: 'snk' })).toEqual({
      accepted: false,
      reason: 'not_in_game',
    });
  });

  it('une mauvaise réponse ne rapporte rien et le chrono continue', () => {
    const t = setup();
    t.game.start();
    t.ready(0);
    vi.advanceTimersByTime(countdownMs);
    expect(t.game.answer('p1', { text: 'One Piece' })).toMatchObject({
      accepted: true,
      correct: false,
      points: 0,
    });
    expect(t.game.currentPhase).toBe('listening');
    vi.advanceTimersByTime(listenMs);
    const reveal = t.last<RoundReveal>('round:reveal');
    expect(reveal.results[0]).toMatchObject({ correct: false, points: 0, elapsedMs: null });
  });

  it('enchaîne toutes les manches puis termine et libère les jetons audio', () => {
    const t = setup();
    t.game.start();
    for (let round = 0; round < 3; round++) {
      t.ready(round);
      vi.advanceTimersByTime(countdownMs + listenMs + revealMs);
    }
    expect(t.all('round:reveal')).toHaveLength(3);
    expect(t.last('game:end')).toMatchObject({ reason: 'completed' });
    expect(t.game.isClosed).toBe(true);
    expect(t.media.size).toBe(0);
    expect(t.onFinished).toHaveBeenCalledOnce();
  });

  it("remplace une musique dont l'audio ne charge pas", () => {
    const t = setup();
    t.game.start();
    const failedUrl = t.prepared(0).url;
    t.game.audioFailed('p1', 0, failedUrl);
    const replacement = t.prepared(0);
    expect(replacement.url).not.toBe(failedUrl);
    expect(t.media.resolve(failedUrl.split('/').pop()!)).toBeNull();

    // Un signalement périmé (ancienne URL) est ignoré.
    t.game.audioFailed('p1', 0, failedUrl);
    expect(t.prepared(0).url).toBe(replacement.url);

    // Plus de remplaçante pour la première manche : partie annulée.
    t.game.audioFailed('p1', 0, replacement.url);
    expect(t.last('game:end')).toMatchObject({ reason: 'audio_unavailable' });
  });

  it('se ferme quand le dernier joueur part', () => {
    const t = setup();
    t.game.start();
    t.game.leave('p1');
    expect(t.game.isClosed).toBe(true);
    expect(t.media.size).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(t.all('round:start')).toHaveLength(0);
  });
});

describe('Game — mode Progressif', () => {
  const progressive = MODE_TIMINGS.progressive;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Partie Progressif démarrée, première manche (S3 OP1) en écoute. */
  function listening() {
    const t = setup(THEME_IDS, 'progressive');
    t.game.start();
    t.ready(0);
    vi.advanceTimersByTime(progressive.countdownMs);
    expect(t.game.currentPhase).toBe('listening');
    return t;
  }

  it('donne les points du palier atteint, plus les bonus', () => {
    const t = listening();
    expect(t.game.nextTier('p1')).toEqual({ tier: 1, attemptsLeft: 3, eliminated: false });
    // Le temps ne compte pas : seul le palier fixe le barème.
    vi.advanceTimersByTime(20_000);
    expect(t.game.answer('p1', { text: 'Attack on Titan Season 3' })).toMatchObject({
      correct: true,
      points: 150 + 25,
      progress: { tier: 1 },
    });
    vi.advanceTimersByTime(0);
    expect(t.last<RoundReveal>('round:reveal').results[0]).toMatchObject({ tier: 1, points: 175 });
  });

  it('passe au palier suivant après 3 erreurs', () => {
    const t = listening();
    expect(t.game.answer('p1', { text: 'One Piece' })).toMatchObject({
      correct: false,
      progress: { tier: 0, attemptsLeft: 2 },
    });
    t.game.answer('p1', { text: 'One Piece' });
    expect(t.game.answer('p1', { text: 'One Piece' })).toMatchObject({
      progress: { tier: 1, attemptsLeft: 3, eliminated: false },
    });
  });

  it('élimine après 3 erreurs au dernier palier et termine la manche', () => {
    const t = listening();
    for (let i = 0; i < 3; i++) t.game.nextTier('p1');
    expect(t.game.nextTier('p1')).toMatchObject({ tier: 3 }); // pas au-delà du dernier palier
    for (let i = 0; i < 2; i++) t.game.answer('p1', { text: 'One Piece' });
    expect(t.game.answer('p1', { text: 'One Piece' })).toMatchObject({
      progress: { tier: 3, attemptsLeft: 0, eliminated: true },
    });
    expect(t.game.answer('p1', { text: 'snk' })).toEqual({
      accepted: false,
      reason: 'eliminated',
    });
    // Solo : plus personne ne peut répondre, révélation immédiate.
    vi.advanceTimersByTime(0);
    expect(t.last<RoundReveal>('round:reveal').results[0]).toMatchObject({
      correct: false,
      points: 0,
    });
  });

  it('laisse 60 s pour répondre', () => {
    const t = listening();
    vi.advanceTimersByTime(progressive.listenMs - 1);
    expect(t.all('round:reveal')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(t.all('round:reveal')).toHaveLength(1);
  });

  it('refuse le palier suivant hors du mode Progressif', () => {
    const t = setup();
    t.game.start();
    t.ready(0);
    vi.advanceTimersByTime(countdownMs);
    expect(t.game.nextTier('p1')).toBeNull();
    expect(t.game.giveUp('p1')).toBeNull();
  });

  it("permet d'abandonner au dernier palier seulement", () => {
    const t = listening();
    // Avant le dernier palier : rien ne change.
    expect(t.game.giveUp('p1')).toMatchObject({ tier: 0, eliminated: false });
    for (let i = 0; i < 3; i++) t.game.nextTier('p1');
    expect(t.game.giveUp('p1')).toMatchObject({ tier: 3, eliminated: true });
    expect(t.game.answer('p1', { text: 'snk' })).toEqual({ accepted: false, reason: 'eliminated' });
    // Solo : tout le monde a fini, révélation immédiate avec 0 point.
    vi.advanceTimersByTime(0);
    expect(t.last<RoundReveal>('round:reveal').results[0]).toMatchObject({
      correct: false,
      points: 0,
    });
  });
});
