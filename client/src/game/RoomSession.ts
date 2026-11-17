import type {
  GameSettings,
  PickedSong,
  PlaylistPickResponse,
  PlaylistPreview,
  PlaylistSong,
  RoomError,
  RoomResponse,
  RoomState,
} from '@blindtest/shared';
import { syncClock } from '../lib/clock';
import { storage, STORAGE_KEYS } from '../lib/storage';
import { ensureConnected, socket } from '../lib/socket';
import { GameSession } from './GameSession';

export interface RoomSessionState {
  room: RoomState;
  /** Partie en cours, ou terminée dont on affiche encore les résultats. */
  game: GameSession | null;
  /** La room a été fermée (supprimée par le serveur). */
  closed: boolean;
}

export type RoomJoinResult =
  { ok: true; session: RoomSession } | { ok: false; error: RoomError | 'connection' };

/**
 * Une room côté navigateur, indépendante de React : état du salon, partie
 * lancée par l'hôte, retour au salon. Lue avec `useSyncExternalStore`.
 */
export class RoomSession {
  private state: RoomSessionState;
  private readonly listeners = new Set<() => void>();
  private volume = 0.8;
  private disposed = false;

  private constructor(
    room: RoomState,
    private readonly pseudo: string,
  ) {
    this.state = { room, game: null, closed: false };
    socket.on('room:state', this.onRoomState);
    socket.on('room:closed', this.onClosed);
    storage.set(STORAGE_KEYS.room, room.code);
    setRoomInUrl(room.code);
  }

  /** Crée une room (`code` absent) ou en rejoint une. */
  static async open(pseudo: string, code?: string): Promise<RoomJoinResult> {
    try {
      await ensureConnected();
      await syncClock(socket);
    } catch {
      return { ok: false, error: 'connection' };
    }
    const response: RoomResponse | null = await (
      code
        ? socket.timeout(10_000).emitWithAck('room:join', { code, pseudo })
        : socket.timeout(10_000).emitWithAck('room:create', { pseudo })
    ).catch(() => null);
    if (!response) return { ok: false, error: 'connection' };
    if (!response.ok) {
      if (response.error === 'not_found') forgetRoom();
      return response;
    }
    const session = new RoomSession(response.room, pseudo);
    // Room déjà en jeu (arrivée en cours de partie) : la partie arrive juste après.
    session.onRoomState(response.room);
    return { ok: true, session };
  }

  getState = (): RoomSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get isHost(): boolean {
    return this.state.room.hostId === this.state.room.you;
  }

  /** « Je suis prêt » : à appeler depuis un clic (le son du navigateur est alors débloqué). */
  setReady(ready: boolean): void {
    socket.emit('room:ready', ready);
  }

  updateSettings(settings: GameSettings): void {
    if (!this.isHost) return;
    // Affichage immédiat chez l'hôte ; le serveur confirme à tout le monde.
    this.update({ room: { ...this.state.room, settings } });
    socket.emit('room:settings', settings);
  }

  async start(): Promise<RoomError | 'connection' | null> {
    const response = await socket
      .timeout(10_000)
      .emitWithAck('room:start')
      .catch(() => null);
    if (!response) return 'connection';
    return response.ok ? null : response.error;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.state.game?.setVolume(volume);
  }

  get currentVolume(): number {
    return this.volume;
  }

  // ─── Playlist : phase de choix ────────────────────────────────────────────

  /** Chansons d'un anime (jetons opaques), `null` en cas d'échec. */
  async songsFor(animeId: number): Promise<PlaylistSong[] | null> {
    const response = await socket
      .timeout(8000)
      .emitWithAck('playlist:songs', { animeId })
      .catch(() => null);
    return response?.ok ? response.songs : null;
  }

  pick(token: string): Promise<PlaylistPickResponse | null> {
    return this.changePicks('playlist:pick', token);
  }

  unpick(token: string): Promise<PlaylistPickResponse | null> {
    return this.changePicks('playlist:unpick', token);
  }

  /** Aperçu de 5 s (audio opaque). */
  preview(token: string): Promise<PlaylistPreview | null> {
    return socket
      .timeout(8000)
      .emitWithAck('playlist:preview', { token })
      .catch(() => null);
  }

  private async changePicks(
    event: 'playlist:pick' | 'playlist:unpick',
    token: string,
  ): Promise<PlaylistPickResponse | null> {
    const response = await socket
      .timeout(8000)
      .emitWithAck(event, { token })
      .catch(() => null);
    if (response?.ok) this.setMine(response.mine);
    return response;
  }

  /** Sa playlist à jour tout de suite (l'état de la room suit). */
  private setMine(mine: PickedSong[]): void {
    const { room } = this.state;
    if (!room.picking) return;
    this.update({ room: { ...room, picking: { ...room.picking, mine } } });
  }

  /** Après les résultats : retour au salon. */
  backToLobby(): void {
    if (this.state.game?.getState().status !== 'ended') return;
    this.state.game.dispose();
    this.update({ game: null });
  }

  /** Quitte la room. */
  leave(): void {
    if (this.disposed) return;
    socket.emit('room:leave');
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    socket.off('room:state', this.onRoomState);
    socket.off('room:closed', this.onClosed);
    this.state.game?.dispose();
    forgetRoom();
  }

  private onRoomState = (room: RoomState): void => {
    let { game } = this.state;
    const current = game?.getState().status;
    if (room.status === 'playing' && (!game || current === 'ended')) {
      // Nouvelle partie : la session écoute tout de suite, avant les premiers événements.
      game?.dispose();
      game = new GameSession(room.settings, this.pseudo, 'room');
      game.setVolume(this.volume);
      game.attach(room.you);
    } else if (room.status === 'lobby' && game && current !== 'ended') {
      // Partie arrêtée sans fin normale (plus personne…) : retour au salon.
      game.dispose();
      game = null;
    } else if (room.status === 'picking' && game) {
      // Playlist relancée pendant qu'on regardait les résultats : place au choix des chansons.
      game.dispose();
      game = null;
    }
    this.update({ room, game });
  };

  private onClosed = (): void => {
    this.update({ closed: true });
    this.dispose();
  };

  private update(patch: Partial<RoomSessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** Lien de la room : la barre d'adresse devient directement partageable. */
function setRoomInUrl(code: string | null): void {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', url);
}

function forgetRoom(): void {
  storage.remove(STORAGE_KEYS.room);
  setRoomInUrl(null);
}

/** Code de room à rejoindre au chargement : lien partagé, ou room en cours avant un rechargement. */
export function pendingRoomCode(): string | null {
  return new URL(window.location.href).searchParams.get('room') ?? storage.get(STORAGE_KEYS.room);
}

export const roomLink = (code: string): string => {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('room', code);
  return url.toString();
};
