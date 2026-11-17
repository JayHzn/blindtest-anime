import {
  DEFAULT_SETTINGS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_AUDIO_WAIT_MS,
  ROOM_INTRO_MS,
  ROOM_MAX_PLAYERS,
  normalizeRoomCode,
  sanitizePseudo,
  sanitizeSettings,
  type GameSettings,
  type RoomError,
  type RoomResponse,
  type RoomState,
} from '@blindtest/shared';
import type { Game, GameEmitter } from '../game/Game';
import type { GameManager } from '../game/GameManager';

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
  /** Depuis quand plus aucun membre n'est connecté (null si quelqu'un l'est). */
  emptySince: number | null;
}

export type StartRoomResult = { ok: true } | { ok: false; error: RoomError };

/** Rooms en mémoire : membres, hôte, réglages et partie en cours. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly roomOfPlayer = new Map<string, string>();

  constructor(
    private readonly games: GameManager,
    private readonly emitter: GameEmitter,
    private readonly random: () => number = Math.random,
  ) {}

  create(playerId: string, rawPseudo: unknown): RoomResponse {
    this.leave(playerId);
    const room: Room = {
      code: this.newCode(),
      hostId: playerId,
      members: new Map(),
      settings: DEFAULT_SETTINGS,
      game: null,
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
    if (room.members.size === 0) {
      this.delete(room);
      return;
    }
    if (room.hostId === playerId) this.transferHost(room);
    this.refreshEmptiness(room);
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
      this.broadcast(room);
      if (room.game) this.games.reconnect(playerId);
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
    if (!room || room.hostId !== playerId || room.game) return;
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
    if (room.game) return { ok: false, error: 'already_playing' };

    // L'hôte est prêt en cliquant « Lancer » ; les autres doivent l'avoir indiqué.
    const host = room.members.get(playerId)!;
    host.ready = true;
    const players = [...room.members.values()].filter((member) => member.connected);
    if (players.some((member) => !member.ready)) {
      this.broadcast(room);
      return { ok: false, error: 'players_not_ready' };
    }
    const result = this.games.create({
      players,
      settings: room.settings,
      introMs: ROOM_INTRO_MS,
      audioWaitMs: ROOM_AUDIO_WAIT_MS,
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
    return {
      code: room.code,
      you: playerId,
      hostId: room.hostId,
      members: [...room.members.values()].map((member) => ({
        ...member,
        isHost: member.id === room.hostId,
      })),
      settings: room.settings,
      status: room.game ? 'playing' : 'lobby',
    };
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
