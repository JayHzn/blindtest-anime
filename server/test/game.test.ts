import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MODE_TIMINGS,
  classicPoints,
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

function setup(themeIds = THEME_IDS) {
  const media = new MediaRegistry();
  const events: Emitted[] = [];
  const emitter: GameEmitter = {
    toPlayer: (to, event, ...args) => events.push({ to, event, payload: args[0] }),
    toAll: (event, ...args) => events.push({ to: 'all', event, payload: args[0] }),
  };
  const onFinished = vi.fn();
  const game = new Game({
    settings: { ...DEFAULT_SETTINGS, rounds: 3 },
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

  it("attend l'audio du joueur, puis démarre quand même au bout du délai", () => {
    const t = setup();
    t.game.start();
    vi.advanceTimersByTime(countdownMs);
    expect(t.all('round:start')).toHaveLength(0);
    vi.advanceTimersByTime(AUDIO_WAIT_MS);
    expect(t.all('round:start')).toHaveLength(1);
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
    t.game.removePlayer('p1');
    expect(t.game.isClosed).toBe(true);
    expect(t.media.size).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(t.all('round:start')).toHaveLength(0);
  });
});
