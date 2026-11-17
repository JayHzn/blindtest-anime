import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MODE_TIMINGS,
  PLAYLIST,
  type GameSnapshot,
  type PlayerScore,
  type PlaylistSong,
  type RoomResponse,
  type RoomState,
  type RoundAudio,
  type RoundReveal,
} from '@blindtest/shared';
import { Game, type GameEmitter } from '../src/game/Game';
import { GameManager } from '../src/game/GameManager';
import { MediaRegistry } from '../src/media/MediaRegistry';
import { PICKING_GRACE_MS } from '../src/rooms/PlaylistPicking';
import { RoomManager } from '../src/rooms/RoomManager';
import { buildFixtureCatalogue } from './fixtures/sources';

const { countdownMs, listenMs } = MODE_TIMINGS.playlist;
const catalogue = buildFixtureCatalogue();
const PLAYERS = ['alice', 'bob', 'chloe'];

interface Emitted {
  to: string;
  event: string;
  payload: unknown;
}

/**
 * Partie Playlist à trois : S3 OP1 choisie par Alice, One Piece OP1 tirée au
 * hasard, Your Name ED choisie par Bob.
 */
function setupGame(choosers: string[][] = [['alice'], [], ['bob']]) {
  const events: Emitted[] = [];
  const emitter: GameEmitter = {
    toPlayer: (to, event, ...args) => events.push({ to, event, payload: args[0] }),
  };
  const game = new Game({
    settings: { ...DEFAULT_SETTINGS, mode: 'playlist', songsPerPlayer: 1 },
    catalogue,
    media: new MediaRegistry(),
    emitter,
    themes: [1011, 2001, 3001, 5001].map((id) => catalogue.getTheme(id)!),
    choosers,
    random: () => 0.5,
  });
  game.addPlayer('alice', 'Alice');
  game.addPlayer('bob', 'Bob');
  game.addPlayer('chloe', 'Chloé');

  const received = (to: string, event: string) =>
    events.filter((e) => e.to === to && e.event === event).map((e) => e.payload);
  const prepared = (round: number) =>
    (received('alice', 'round:prepare') as RoundAudio[]).filter((a) => a.round === round).at(-1)!;
  /** Place la partie en écoute de la manche `round`. */
  const listen = (round: number) => {
    if (round === 0) game.start();
    for (const id of PLAYERS) game.audioReady(id, round, prepared(round).url);
    vi.advanceTimersByTime(countdownMs);
    expect(game.currentPhase).toBe('listening');
  };
  const lastReveal = () => received('alice', 'round:reveal').at(-1) as RoundReveal;
  return { game, events, received, listen, lastReveal };
}

describe('Game — Playlist', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fixe le nombre de manches sur les chansons choisies', () => {
    const t = setupGame();
    expect(t.game.totalRounds).toBe(3);
  });

  it('qui a choisi la chanson écoute sans répondre ; les autres ne le savent pas', () => {
    const t = setupGame();
    t.listen(0);
    expect(t.received('alice', 'round:start').at(-1)).toMatchObject({ ownSong: true });
    expect(t.received('bob', 'round:start').at(-1)).toMatchObject({ ownSong: false });
    expect(t.game.answer('alice', { text: 'snk' })).toEqual({
      accepted: false,
      reason: 'own_song',
    });
  });

  it('seul qui a choisi la chanson voit qui a trouvé ; les autres ont un compteur anonyme', () => {
    const t = setupGame();
    t.listen(0);
    vi.advanceTimersByTime(1500);
    // Points de rapidité seulement : le bonus « Chanson d'un joueur » n'arrive qu'à la révélation.
    expect(t.game.answer('bob', { text: 'snk' })).toMatchObject({ correct: true, points: 185 });

    expect(t.received('alice', 'player:found').at(-1)).toMatchObject({ playerId: 'bob' });
    expect(t.received('chloe', 'player:found')).toHaveLength(0);
    expect(t.received('bob', 'player:found')).toHaveLength(0);
    expect(t.received('chloe', 'playlist:found').at(-1)).toEqual({ found: 1 });

    // Classement de Chloé : ni coche, ni score qui bouge.
    const snapshot = t.game.snapshot('chloe');
    expect(snapshot.players.every((p) => !p.found && p.score === 0)).toBe(true);
    expect(snapshot.playlist).toMatchObject({ ownSong: false, found: 1, guessWindowEndsAt: null });
    expect(snapshot.playlist?.guess).toBeUndefined();
    // Alice, elle, voit la coche de Bob.
    const forAlice = t.received('alice', 'player:found').at(-1) as { players: PlayerScore[] };
    expect(forAlice.players.find((p) => p.id === 'bob')?.found).toBe(true);
    expect(t.game.snapshot('alice').players.find((p) => p.id === 'bob')?.found).toBe(true);
  });

  it("rien n'indique aux autres qui a choisi la chanson avant la révélation", () => {
    const t = setupGame();
    t.listen(0);
    t.game.answer('bob', { text: 'snk' });
    t.game.answer('chloe', { text: 'snk' });
    const beforeReveal = t.events.findIndex((e) => e.event === 'round:reveal');
    const leaked = t.events
      .slice(0, beforeReveal === -1 ? undefined : beforeReveal)
      .filter((e) => e.to !== 'alice')
      .filter((e) => JSON.stringify(e.payload).includes('"ownSong":true'));
    expect(leaked).toEqual([]);
  });

  it('un seul pari, après avoir trouvé, parmi les autres joueurs ou « personne »', () => {
    const t = setupGame();
    t.listen(0);
    expect(t.game.guess('chloe', 'alice')).toBe(false); // pas encore trouvé
    t.game.answer('bob', { text: 'snk' });
    expect(t.game.guess('bob', 'bob')).toBe(false); // pas soi-même
    expect(t.game.guess('bob', 'inconnu')).toBe(false);
    expect(t.game.guess('bob', 'alice')).toBe(true);
    expect(t.game.guess('bob', null)).toBe(false); // déjà parié
  });

  it('tout le monde a trouvé : 7 s pour deviner, puis la révélation', () => {
    const t = setupGame();
    t.listen(0);
    t.game.answer('bob', { text: 'snk' });
    t.game.answer('chloe', { text: 'snk' });
    vi.advanceTimersByTime(0);
    expect(t.game.currentPhase).toBe('listening');
    const window = t.received('chloe', 'playlist:guessWindow').at(-1) as { endsAt: number };
    expect(window.endsAt - Date.now()).toBe(PLAYLIST.guessWindowMs);
    vi.advanceTimersByTime(PLAYLIST.guessWindowMs);
    expect(t.game.currentPhase).toBe('reveal');
  });

  it('révélation plus tôt si tout le monde a parié', () => {
    const t = setupGame();
    t.listen(0);
    t.game.answer('bob', { text: 'snk' });
    t.game.guess('bob', 'alice');
    t.game.answer('chloe', { text: 'snk' });
    vi.advanceTimersByTime(0);
    expect(t.game.currentPhase).toBe('listening');
    t.game.guess('chloe', null);
    vi.advanceTimersByTime(0);
    expect(t.game.currentPhase).toBe('reveal');
  });

  it('barème : bonus « Chanson d’un joueur », pari, et points de qui a choisi la chanson', () => {
    const t = setupGame();
    t.listen(0);
    vi.advanceTimersByTime(1500);
    t.game.answer('bob', { text: 'snk' }); // 185
    t.game.guess('bob', 'alice');
    vi.advanceTimersByTime(listenMs - 1500);

    const reveal = t.lastReveal();
    expect(reveal.playlist).toEqual({
      choosers: [{ id: 'alice', pseudo: 'Alice' }],
      answerers: 2,
      found: 1,
      chooserPoints: 50, // Chloé n'a pas trouvé
      guesses: [{ playerId: 'bob', guess: 'alice', correct: true }],
    });
    const bob = reveal.results.find((r) => r.playerId === 'bob')!;
    expect(bob.points).toBe(185 + PLAYLIST.foundBonus + PLAYLIST.guessBonus);
    expect(bob.playlist).toEqual({
      ownSong: false,
      foundBonus: 50,
      guessBonus: 50,
      chooserPoints: 0,
    });
    const alice = reveal.results.find((r) => r.playerId === 'alice')!;
    expect(alice).toMatchObject({ points: 50, playlist: { ownSong: true, chooserPoints: 50 } });
    expect(reveal.players.map((p) => [p.id, p.score])).toEqual([
      ['bob', 285],
      ['alice', 50],
      ['chloe', 0],
    ]);
  });

  it('qui a choisi la chanson ne gagne rien si tout le monde trouve', () => {
    const t = setupGame();
    t.listen(0);
    t.game.answer('bob', { text: 'snk' });
    t.game.answer('chloe', { text: 'snk' });
    vi.advanceTimersByTime(PLAYLIST.guessWindowMs);
    expect(t.lastReveal().playlist).toMatchObject({ found: 2, chooserPoints: 0 });
  });

  it('chanson tirée au hasard : pas de bonus « Chanson d’un joueur », « personne » est le bon pari', () => {
    const t = setupGame();
    t.listen(0);
    vi.advanceTimersByTime(listenMs);
    vi.advanceTimersByTime(MODE_TIMINGS.playlist.revealMs);
    t.listen(1);
    t.game.answer('alice', { text: 'one piece' });
    t.game.guess('alice', null);
    vi.advanceTimersByTime(listenMs);
    const reveal = t.lastReveal();
    expect(reveal.playlist).toMatchObject({ choosers: [], chooserPoints: 0, answerers: 3 });
    const alice = reveal.results.find((r) => r.playerId === 'alice')!;
    expect(alice.playlist).toMatchObject({ foundBonus: 0, guessBonus: PLAYLIST.guessBonus });
  });

  it('une chanson choisie par deux joueurs : aucun ne répond, les deux marquent', () => {
    const t = setupGame([['alice', 'bob'], [], []]);
    t.listen(0);
    expect(t.game.answer('bob', { text: 'snk' })).toMatchObject({ reason: 'own_song' });
    t.game.answer('chloe', { text: 'snk' });
    t.game.guess('chloe', 'bob');
    vi.advanceTimersByTime(0);
    // Chloé était la seule à répondre et a trouvé : 0 point pour Alice et Bob.
    const reveal = t.lastReveal();
    expect(reveal.playlist?.choosers.map((c) => c.id)).toEqual(['alice', 'bob']);
    expect(reveal.playlist?.guesses).toEqual([{ playerId: 'chloe', guess: 'bob', correct: true }]);
  });

  it("la chanson d'un joueur qui part devient une chanson sans joueur", () => {
    const t = setupGame();
    t.listen(0);
    t.game.leave('bob');
    vi.advanceTimersByTime(listenMs + MODE_TIMINGS.playlist.revealMs);
    t.listen(1);
    vi.advanceTimersByTime(listenMs + MODE_TIMINGS.playlist.revealMs);
    for (const id of ['alice', 'chloe']) {
      const audio = (t.received(id, 'round:prepare') as RoundAudio[]).filter((a) => a.round === 2);
      t.game.audioReady(id, 2, audio.at(-1)!.url);
    }
    vi.advanceTimersByTime(countdownMs);
    expect(t.received('alice', 'round:start').at(-1)).toMatchObject({ round: 2, ownSong: false });
    expect(t.received('chloe', 'round:start').at(-1)).toMatchObject({ round: 2, ownSong: false });
  });
});

describe('RoomManager — phase de choix Playlist', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setupRoom(players = PLAYERS) {
    const events: Emitted[] = [];
    const emitter: GameEmitter = {
      toPlayer: (to, event, ...args) => events.push({ to, event, payload: args[0] }),
    };
    const media = new MediaRegistry();
    const games = new GameManager(catalogue, media, emitter);
    const rooms = new RoomManager(games, emitter, Math.random, { catalogue, media });
    const created = rooms.create(players[0]!, 'Alice') as Extract<RoomResponse, { ok: true }>;
    for (const id of players.slice(1)) rooms.join(created.room.code, id, id);
    for (const id of players) rooms.setReady(id, true);
    rooms.updateSettings(players[0]!, {
      ...DEFAULT_SETTINGS,
      mode: 'playlist',
      songsPerPlayer: 1,
    });
    const lastState = (to: string) =>
      events.filter((e) => e.to === to && e.event === 'room:state').at(-1)?.payload as RoomState;
    const songs = (id: string, animeId: number) => {
      const response = rooms.songs(id, animeId);
      if (!response.ok) throw new Error('pas de chansons');
      return response.songs;
    };
    return { rooms, games, events, media, lastState, songs };
  }

  it('3 joueurs minimum', () => {
    const t = setupRoom(['alice', 'bob']);
    expect(t.rooms.start('alice')).toEqual({ ok: false, error: 'not_enough_players' });
  });

  it('ouvre la phase de choix ; les jetons sont opaques et propres à chaque joueur', () => {
    const t = setupRoom();
    expect(t.rooms.start('alice')).toEqual({ ok: true });
    expect(t.lastState('bob')).toMatchObject({
      status: 'picking',
      picking: { songsPerPlayer: 1, mine: [] },
    });
    const forAlice = t.songs('alice', 101);
    const forBob = t.songs('bob', 101);
    expect(forAlice.map((s) => `${s.type}${s.sequence}`)).toEqual(['OP1', 'OP2']);
    expect(forAlice[0]!.token).not.toBe(forBob[0]!.token);
    expect(JSON.stringify(forAlice)).not.toMatch(/1011|1012/);
    // Le jeton d'un autre joueur ne marche pas.
    expect(t.rooms.pick('bob', forAlice[0]!.token)).toEqual({ ok: false, error: 'invalid' });
  });

  it('chacun voit ses choix, et seulement le nombre de chansons des autres', () => {
    const t = setupRoom();
    t.rooms.start('alice');
    const song = t.songs('alice', 101)[0]!;
    const response = t.rooms.pick('alice', song.token);
    expect(response).toMatchObject({ ok: true, mine: [{ token: song.token, type: 'OP' }] });
    expect(t.rooms.pick('alice', song.token)).toMatchObject({ ok: false });

    const forBob = t.lastState('bob').picking!;
    expect(forBob.mine).toEqual([]);
    expect(forBob.progress).toContainEqual({ playerId: 'alice', count: 1 });
    expect(JSON.stringify(t.lastState('bob'))).not.toContain(song.token);
  });

  it("l'aperçu passe par le proxy audio, à partir de 25 % du morceau", () => {
    const t = setupRoom();
    t.rooms.start('alice');
    const song = t.songs('alice', 200)[0]!;
    const first = t.rooms.preview('alice', song.token)!;
    expect(first).toMatchObject({ startRatio: 0.25 });
    expect(first.url).toMatch(/^\/api\/audio\/[\w-]+$/);
    // Un seul aperçu à la fois : le précédent est révoqué.
    const second = t.rooms.preview('alice', song.token)!;
    expect(t.media.resolve(first.url.split('/').pop()!)).toBeNull();
    expect(t.media.resolve(second.url.split('/').pop()!)).not.toBeNull();
  });

  it('tout le monde a choisi : la partie démarre ; doublons fusionnés', () => {
    const t = setupRoom();
    t.rooms.start('alice');
    const pick = (id: string, animeId: number) =>
      t.rooms.pick(id, (t.songs(id, animeId) as PlaylistSong[])[0]!.token);
    pick('alice', 101);
    pick('bob', 101); // même chanson qu'Alice
    pick('chloe', 200);
    expect(t.lastState('alice').picking!.endsAt - Date.now()).toBe(PICKING_GRACE_MS);
    vi.advanceTimersByTime(PICKING_GRACE_MS);

    expect(t.lastState('alice').status).toBe('playing');
    const snapshot = t.events.filter((e) => e.to === 'chloe' && e.event === 'game:state').at(-1)!
      .payload as GameSnapshot;
    expect(snapshot.totalRounds).toBe(2);
    expect(snapshot.settings.mode).toBe('playlist');
  });

  it('temps écoulé : les chansons manquantes sont tirées au hasard', () => {
    const t = setupRoom();
    t.rooms.start('alice');
    t.rooms.pick('alice', t.songs('alice', 101)[0]!.token);
    vi.advanceTimersByTime(60_000);
    const snapshot = t.events.filter((e) => e.to === 'bob' && e.event === 'game:state').at(-1)!
      .payload as GameSnapshot;
    // 1 choisie + 2 tirées (jamais la série déjà choisie).
    expect(snapshot.totalRounds).toBe(3);
  });

  it('un joueur qui part pendant le choix : ses chansons sont retirées', () => {
    const t = setupRoom([...PLAYERS, 'dan']);
    t.rooms.start('alice');
    t.rooms.pick('dan', t.songs('dan', 200)[0]!.token);
    t.rooms.leave('dan');
    expect(t.lastState('alice').picking!.progress.map((p) => p.playerId)).not.toContain('dan');
  });
});
