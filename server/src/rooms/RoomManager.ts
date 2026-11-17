import {
  DEFAULT_SETTINGS,
  PLAYLIST,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_AUDIO_WAIT_MS,
  ROOM_INTRO_MS,
  ROOM_MAX_PLAYERS,
  drawPlaylist,
  minPlayers,
  normalizeRoomCode,
  sanitizePseudo,
  sanitizeSettings,
  type GameSettings,
  type PlaylistPick,
  type PlaylistPickResponse,
  type PlaylistPreview,
  type PlaylistSongsResponse,
  type RoomError,
  type RoomResponse,
  type RoomState,
} from '@blindtest/shared';
import type { Catalogue } from '../catalogue/Catalogue';
import type { Game, GameEmitter } from '../game/Game';
import type { GameManager } from '../game/GameManager';
import type { MediaRegistry } from '../media/MediaRegistry';
import { PlaylistPicking } from './PlaylistPicking';

/** Une room sans joueur connecté est supprimée au bout de ce délai. */
export const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

interface Member {
  id: string;
  pseudo: string;
  connected: boolean;
  /** « Je suis prêt » (le clic débloque le son dans son navigateur). */
  ready: boolean;
}

interface Room {
  code: string;
  hostId: string;
  /** Ordre d'arrivée conservé (Map). */
  members: Map<string, Member>;
  settings: GameSettings;
  game: Game | null;
  /** Playlist : phase de choix des chansons, avant la partie. */
  picking: PlaylistPicking | null;
  /** Depuis quand plus aucun membre n'est connecté (null si quelqu'un l'est). */
  emptySince: number | null;
}

export type StartRoomResult = { ok: true } | { ok: false; error: RoomError };

/** Dépendances du mode Playlist (catalogue pour les chansons, proxy audio pour l'aperçu). */
export interface PlaylistDeps {
  catalogue: Catalogue | null;
  media: MediaRegistry;
}

/** Rooms en mémoire : membres, hôte, réglages et partie en cours. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly roomOfPlayer = new Map<string, string>();

  constructor(
    private readonly games: GameManager,
    private readonly emitter: GameEmitter,
    private readonly random: () => number = Math.random,
    private readonly playlist: PlaylistDeps | null = null,
  ) {}

  create(playerId: string, rawPseudo: unknown): RoomResponse {
    this.leave(playerId);
    const room: Room = {
      code: this.newCode(),
      hostId: playerId,
      members: new Map(),
      settings: DEFAULT_SETTINGS,
      game: null,
      picking: null,
      emptySince: null,
    };
    room.members.set(playerId, {
      id: playerId,
      pseudo: sanitizePseudo(rawPseudo),
      connected: true,
      ready: false,
    });
    this.rooms.set(room.code, room);
    this.roomOfPlayer.set(playerId, room.code);
    return { ok: true, room: this.stateFor(room, playerId) };
  }

  /** Rejoint une room ; un membre déjà présent y revient simplement (reconnexion). */
  join(rawCode: unknown, playerId: string, rawPseudo: unknown): RoomResponse {
    const code = normalizeRoomCode(rawCode);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) return { ok: false, error: 'not_found' };

    // L'état de la partie doit arriver APRÈS la réponse à `room:join` : c'est elle
    // qui fait écouter les événements de jeu au navigateur. D'où le setImmediate.
    const existing = room.members.get(playerId);
    if (existing) {
      this.reconnect(playerId, { deferNotify: true });
      return { ok: true, room: this.stateFor(room, playerId) };
    }
    if (room.members.size >= ROOM_MAX_PLAYERS) return { ok: false, error: 'full' };

    this.leave(playerId);
    const pseudo = this.uniquePseudo(room, sanitizePseudo(rawPseudo));
    room.members.set(playerId, { id: playerId, pseudo, connected: true, ready: false });
    room.emptySince = null;
    this.roomOfPlayer.set(playerId, room.code);
    this.broadcast(room);
    // Partie en cours : il joue à partir de la prochaine manche.
    const game = room.game;
    if (game) setImmediate(() => !game.isClosed && this.games.join(game, playerId, pseudo));
    return { ok: true, room: this.stateFor(room, playerId) };
  }

  /** Le joueur quitte la room (et sa partie). */
  leave(playerId: string): void {
    const room = this.roomOf(playerId);
    if (!room) return;
    this.roomOfPlayer.delete(playerId);
    room.members.delete(playerId);
    if (room.game) this.games.leave(playerId);
    // Départ pendant la phase de choix : ses chansons sont retirées.
    room.picking?.removePlayer(playerId);
    if (room.members.size === 0) {
      this.delete(room);
      return;
    }
    if (room.hostId === playerId) this.transferHost(room);
    this.refreshEmptiness(room);
    room.picking?.refresh(this.connectedIds(room));
    this.broadcast(room);
  }

  /** Coupure réseau : le joueur reste membre (et garde son score). */
  disconnect(playerId: string): void {
    const room = this.roomOf(playerId);
    const member = room?.members.get(playerId);
    if (!room || !member) return;
    member.connected = false;
    // Après un rechargement, le navigateur exige un nouveau clic pour le son.
    member.ready = false;
    if (room.game) this.games.disconnect(playerId);
    // Un hôte déconnecté passe la main pour ne pas bloquer les autres.
    if (room.hostId === playerId) this.transferHost(room);
    this.refreshEmptiness(room);
    room.picking?.refresh(this.connectedIds(room));
    this.broadcast(room);
  }

  /** Le joueur revient : état de la room, puis de la partie en cours. */
  reconnect(playerId: string, { deferNotify = false } = {}): void {
    const room = this.roomOf(playerId);
    const member = room?.members.get(playerId);
    if (!room || !member) return;
    member.connected = true;
    room.emptySince = null;
    if (!room.members.get(room.hostId)?.connected) room.hostId = playerId;
    const notify = () => {
      room.picking?.refresh(this.connectedIds(room));
      this.broadcast(room);
      // Rejoint la partie s'il n'y était pas (déconnecté au lancement), sinon reprend sa place.
      const game = room.game;
      if (game && !game.isClosed) this.games.join(game, playerId, member.pseudo);
    };
    if (deferNotify) setImmediate(notify);
    else notify();
  }

  /** « Je suis prêt » (ou plus prêt) dans le salon. */
  setReady(playerId: string, ready: boolean): void {
    const member = this.roomOf(playerId)?.members.get(playerId);
    if (!member || member.ready === ready) return;
    member.ready = ready;
    this.broadcast(this.roomOf(playerId)!);
  }

  updateSettings(playerId: string, rawSettings: unknown): void {
    const room = this.roomOf(playerId);
    if (!room || room.hostId !== playerId || room.game || room.picking) return;
    const settings = sanitizeSettings(rawSettings);
    if (!settings) return;
    room.settings = settings;
    this.broadcast(room);
  }

  /** L'hôte lance la partie pour tous les membres connectés. */
  start(playerId: string): StartRoomResult {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'not_in_room' };
    if (room.hostId !== playerId) return { ok: false, error: 'not_host' };
    if (room.game || room.picking) return { ok: false, error: 'already_playing' };

    // L'hôte est prêt en cliquant « Lancer » ; les autres doivent l'avoir indiqué.
    const host = room.members.get(playerId)!;
    host.ready = true;
    const players = [...room.members.values()].filter((member) => member.connected);
    if (players.some((member) => !member.ready)) {
      this.broadcast(room);
      return { ok: false, error: 'players_not_ready' };
    }
    // Enchères (2) et Playlist (3) : nombre minimal de joueurs connectés.
    if (players.length < minPlayers(room.settings.mode)) {
      return { ok: false, error: 'not_enough_players' };
    }
    if (room.settings.mode === 'playlist') return this.startPicking(room, players.length);
    return this.launch(room, players, {});
  }

  /** Lance la partie (après la phase de choix en Playlist). */
  private launch(
    room: Room,
    players: Member[],
    extra: { playlist?: ReturnType<typeof drawPlaylist>; offline?: string[] },
  ): StartRoomResult {
    const result = this.games.create({
      players,
      settings: room.settings,
      introMs: ROOM_INTRO_MS,
      audioWaitMs: ROOM_AUDIO_WAIT_MS,
      ...extra,
      onFinished: (game) => {
        if (room.game !== game) return;
        room.game = null;
        this.broadcast(room);
      },
    });
    if (!result.ok) return result;

    room.game = result.game;
    // L'état « en jeu » part avant les événements de la partie : le client s'y prépare.
    this.broadcast(room);
    result.game.start();
    return { ok: true };
  }

  // ─── Playlist : phase de choix ────────────────────────────────────────────

  private startPicking(room: Room, connected: number): StartRoomResult {
    if (connected < PLAYLIST.minPlayers) return { ok: false, error: 'not_enough_players' };
    const deps = this.playlist;
    if (!deps?.catalogue) return { ok: false, error: 'catalogue_unavailable' };
    room.picking = new PlaylistPicking({
      catalogue: deps.catalogue,
      media: deps.media,
      songsPerPlayer: room.settings.songsPerPlayer ?? PLAYLIST.songsDefault,
      types: room.settings.filters.types,
      onDone: () => this.finishPicking(room),
    });
    this.broadcast(room);
    return { ok: true };
  }

  /**
   * Fin de la phase de choix : les chansons manquantes sont tirées au hasard
   * (filtres de la room, hors séries déjà choisies), puis la partie démarre.
   */
  private finishPicking(room: Room): void {
    const picking = room.picking;
    const catalogue = this.playlist?.catalogue;
    if (!picking || !catalogue || this.rooms.get(room.code) !== room) return;
    room.picking = null;

    const members = [...room.members.values()];
    const picks: PlaylistPick[] = picking.picks(members.map((member) => member.id));
    const missing = members.reduce(
      (sum, member) => sum + Math.max(0, picking.songsPerPlayer - picking.count(member.id)),
      0,
    );
    const usedFranchises = new Set(picks.map((pick) => catalogue.franchiseOfTheme(pick.themeId)!));
    for (const theme of catalogue.pickThemes(
      room.settings.filters,
      missing,
      this.random,
      usedFranchises,
    )) {
      picks.push({ playerId: null, themeId: theme.id });
    }

    const result = this.launch(room, members, {
      playlist: drawPlaylist(picks, this.random),
      offline: members.filter((member) => !member.connected).map((member) => member.id),
    });
    if (!result.ok) this.broadcast(room);
  }

  songs(playerId: string, animeId: unknown): PlaylistSongsResponse {
    const songs =
      typeof animeId === 'number' ? this.roomOf(playerId)?.picking?.songs(playerId, animeId) : null;
    return songs ? { ok: true, songs } : { ok: false };
  }

  pick(playerId: string, token: unknown): PlaylistPickResponse {
    return this.updatePicks(playerId, (picking) => picking.pick(playerId, token));
  }

  unpick(playerId: string, token: unknown): PlaylistPickResponse {
    return this.updatePicks(playerId, (picking) => picking.unpick(playerId, token));
  }

  preview(playerId: string, token: unknown): PlaylistPreview | null {
    return this.roomOf(playerId)?.picking?.preview(playerId, token) ?? null;
  }

  private updatePicks(
    playerId: string,
    change: (picking: PlaylistPicking) => PlaylistPickResponse,
  ): PlaylistPickResponse {
    const room = this.roomOf(playerId);
    if (!room?.picking) return { ok: false, error: 'not_picking' };
    const response = change(room.picking);
    if (response.ok) {
      room.picking.refresh(this.connectedIds(room));
      // L'avancement (nombres seulement) change pour tout le monde.
      this.broadcast(room);
    }
    return response;
  }

  private connectedIds(room: Room): string[] {
    return [...room.members.values()].filter((member) => member.connected).map((m) => m.id);
  }

  roomCodeOf(playerId: string): string | null {
    return this.roomOfPlayer.get(playerId) ?? null;
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Supprime les rooms vides depuis trop longtemps (appelé régulièrement). */
  sweep(now = Date.now(), ttlMs = EMPTY_ROOM_TTL_MS): void {
    for (const room of [...this.rooms.values()]) {
      if (room.emptySince !== null && now - room.emptySince >= ttlMs) this.delete(room);
    }
  }

  closeAll(): void {
    for (const room of [...this.rooms.values()]) this.delete(room);
  }

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  private roomOf(playerId: string): Room | undefined {
    const code = this.roomOfPlayer.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  private delete(room: Room): void {
    room.game?.close();
    room.picking?.close();
    room.picking = null;
    this.rooms.delete(room.code);
    for (const id of room.members.keys()) {
      this.roomOfPlayer.delete(id);
      this.emitter.toPlayer(id, 'room:closed');
    }
  }

  private transferHost(room: Room): void {
    const members = [...room.members.values()];
    const next = members.find((member) => member.connected) ?? members[0];
    if (next) room.hostId = next.id;
  }

  private refreshEmptiness(room: Room): void {
    const anyoneConnected = [...room.members.values()].some((member) => member.connected);
    if (anyoneConnected) room.emptySince = null;
    else room.emptySince ??= Date.now();
  }

  private broadcast(room: Room): void {
    for (const id of room.members.keys()) {
      this.emitter.toPlayer(id, 'room:state', this.stateFor(room, id));
    }
  }

  private stateFor(room: Room, playerId: string): RoomState {
    const state: RoomState = {
      code: room.code,
      you: playerId,
      hostId: room.hostId,
      members: [...room.members.values()].map((member) => ({
        ...member,
        isHost: member.id === room.hostId,
      })),
      settings: room.settings,
      status: 'lobby',
    };
    if (room.picking) state.status = 'picking';
    if (room.game) state.status = 'playing';
    if (room.picking) state.picking = room.picking.stateFor(playerId, [...room.members.keys()]);
    return state;
  }

  /** Deux « Sakura » dans la même room deviennent « Sakura » et « Sakura 2 ». */
  private uniquePseudo(room: Room, pseudo: string): string {
    const taken = new Set([...room.members.values()].map((m) => m.pseudo.toLowerCase()));
    if (!taken.has(pseudo.toLowerCase())) return pseudo;
    for (let n = 2; ; n++) {
      const candidate = `${pseudo.slice(0, 17)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(this.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }
}
