import { randomBytes } from 'node:crypto';
import {
  PLAYLIST,
  pickingDurationMs,
  type PickedSong,
  type PickingState,
  type PlaylistPick,
  type PlaylistPickResponse,
  type PlaylistPreview,
  type PlaylistSong,
  type ThemeType,
} from '@blindtest/shared';
import type { Catalogue } from '../catalogue/Catalogue';
import { audioPath, type MediaRegistry } from '../media/MediaRegistry';

/** Quand tout le monde a rempli sa playlist, la partie démarre après ce court délai. */
export const PICKING_GRACE_MS = 3000;
/** Garde-fou : nombre de jetons de chanson par joueur pendant la phase de choix. */
const MAX_TOKENS_PER_PLAYER = 3000;

interface Chooser {
  /** Chansons choisies, dans l'ordre. */
  picks: number[];
  /** Jetons opaques propres au joueur : jeton → chanson, et l'inverse. */
  themeOfToken: Map<string, number>;
  tokenOfTheme: Map<number, string>;
  /** Jeton média de l'aperçu en cours (un seul à la fois). */
  preview: string | null;
}

export interface PlaylistPickingOptions {
  catalogue: Catalogue;
  media: MediaRegistry;
  songsPerPlayer: number;
  /** Types de chanson autorisés (filtre OP/ED de la room). */
  types: readonly ThemeType[];
  /** Fin de la phase de choix (temps écoulé ou tout le monde prêt). */
  onDone: () => void;
  durationMs?: number;
}

/**
 * Phase de choix du mode Playlist. Chaque joueur voit ses propres choix et
 * seulement le nombre de chansons des autres. Les chansons sont désignées par
 * des jetons opaques propres à chaque joueur : rien ne circule qui permette de
 * comparer les choix de deux joueurs.
 */
export class PlaylistPicking {
  readonly songsPerPlayer: number;
  private readonly catalogue: Catalogue;
  private readonly media: MediaRegistry;
  private readonly types: readonly ThemeType[];
  private readonly onDone: () => void;
  private readonly deadline: number;
  private endsAtValue: number;
  private timer: NodeJS.Timeout | null = null;
  private readonly choosers = new Map<string, Chooser>();
  private done = false;

  constructor(options: PlaylistPickingOptions) {
    this.catalogue = options.catalogue;
    this.media = options.media;
    this.songsPerPlayer = options.songsPerPlayer;
    this.types = options.types;
    this.onDone = options.onDone;
    this.deadline = Date.now() + (options.durationMs ?? pickingDurationMs(options.songsPerPlayer));
    this.endsAtValue = this.deadline;
    this.arm();
  }

  get endsAt(): number {
    return this.endsAtValue;
  }

  /** Chansons d'un anime, avec des jetons propres au joueur. */
  songs(playerId: string, animeId: number): PlaylistSong[] | null {
    if (this.done || !Number.isInteger(animeId)) return null;
    const chooser = this.chooser(playerId);
    if (chooser.themeOfToken.size >= MAX_TOKENS_PER_PLAYER) return null;
    return this.catalogue.themesOfAnime(animeId, this.types).map((theme) => ({
      token: this.tokenFor(chooser, theme.id),
      type: theme.type,
      sequence: theme.sequence,
      song: theme.songTitle,
      artists: theme.artists,
    }));
  }

  pick(playerId: string, token: unknown): PlaylistPickResponse {
    if (this.done) return { ok: false, error: 'not_picking' };
    const chooser = this.chooser(playerId);
    const themeId = typeof token === 'string' ? chooser.themeOfToken.get(token) : undefined;
    if (themeId === undefined) return { ok: false, error: 'invalid' };
    if (chooser.picks.includes(themeId)) return { ok: false, error: 'duplicate' };
    if (chooser.picks.length >= this.songsPerPlayer) return { ok: false, error: 'full' };
    chooser.picks.push(themeId);
    return { ok: true, mine: this.mine(chooser) };
  }

  unpick(playerId: string, token: unknown): PlaylistPickResponse {
    if (this.done) return { ok: false, error: 'not_picking' };
    const chooser = this.chooser(playerId);
    const themeId = typeof token === 'string' ? chooser.themeOfToken.get(token) : undefined;
    if (themeId === undefined) return { ok: false, error: 'invalid' };
    chooser.picks = chooser.picks.filter((id) => id !== themeId);
    return { ok: true, mine: this.mine(chooser) };
  }

  /** Aperçu de 5 s : un jeton audio opaque, révoqué au suivant (un seul aperçu à la fois). */
  preview(playerId: string, token: unknown): PlaylistPreview | null {
    if (this.done) return null;
    const chooser = this.chooser(playerId);
    const themeId = typeof token === 'string' ? chooser.themeOfToken.get(token) : undefined;
    const theme = themeId === undefined ? undefined : this.catalogue.getTheme(themeId);
    if (!theme) return null;
    if (chooser.preview) this.media.revoke(chooser.preview);
    chooser.preview = this.media.register(theme.audioUrl, 'audio');
    return { url: audioPath(chooser.preview), startRatio: PLAYLIST.previewStartRatio };
  }

  /** Départ volontaire : ses choix sont retirés. */
  removePlayer(playerId: string): void {
    const chooser = this.choosers.get(playerId);
    if (chooser?.preview) this.media.revoke(chooser.preview);
    this.choosers.delete(playerId);
  }

  count(playerId: string): number {
    return this.choosers.get(playerId)?.picks.length ?? 0;
  }

  /**
   * Tout le monde (connecté) a rempli sa playlist : la partie démarre bientôt.
   * Sinon, retour à l'échéance normale. Renvoie vrai si l'échéance a changé.
   */
  refresh(connectedIds: string[]): boolean {
    if (this.done) return false;
    const allFull =
      connectedIds.length > 0 && connectedIds.every((id) => this.count(id) >= this.songsPerPlayer);
    const target = allFull ? Math.min(this.deadline, Date.now() + PICKING_GRACE_MS) : this.deadline;
    if (allFull && this.endsAtValue < this.deadline) return false;
    if (target === this.endsAtValue) return false;
    this.endsAtValue = target;
    this.arm();
    return true;
  }

  stateFor(playerId: string, memberIds: string[]): PickingState {
    const chooser = this.choosers.get(playerId);
    return {
      endsAt: this.endsAtValue,
      songsPerPlayer: this.songsPerPlayer,
      mine: chooser ? this.mine(chooser) : [],
      progress: memberIds.map((id) => ({ playerId: id, count: this.count(id) })),
    };
  }

  /** Choix des joueurs encore présents. */
  picks(memberIds: string[]): PlaylistPick[] {
    return memberIds.flatMap((playerId) =>
      (this.choosers.get(playerId)?.picks ?? []).map((themeId) => ({ playerId, themeId })),
    );
  }

  close(): void {
    this.done = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const chooser of this.choosers.values()) {
      if (chooser.preview) this.media.revoke(chooser.preview);
      chooser.preview = null;
    }
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (this.done) return;
        this.close();
        this.onDone();
      },
      Math.max(0, this.endsAtValue - Date.now()),
    );
  }

  private chooser(playerId: string): Chooser {
    let chooser = this.choosers.get(playerId);
    if (!chooser) {
      chooser = { picks: [], themeOfToken: new Map(), tokenOfTheme: new Map(), preview: null };
      this.choosers.set(playerId, chooser);
    }
    return chooser;
  }

  private tokenFor(chooser: Chooser, themeId: number): string {
    let token = chooser.tokenOfTheme.get(themeId);
    if (!token) {
      token = randomBytes(9).toString('base64url');
      chooser.tokenOfTheme.set(themeId, token);
      chooser.themeOfToken.set(token, themeId);
    }
    return token;
  }

  private mine(chooser: Chooser): PickedSong[] {
    return chooser.picks.flatMap((themeId) => {
      const theme = this.catalogue.getTheme(themeId);
      const anime = theme ? this.catalogue.getAnime(theme.animeId) : undefined;
      if (!theme || !anime) return [];
      return [
        {
          token: this.tokenFor(chooser, themeId),
          anime: {
            fr: this.catalogue.animeTitle(anime, 'fr'),
            en: this.catalogue.animeTitle(anime, 'en'),
          },
          type: theme.type,
          sequence: theme.sequence,
          song: theme.songTitle,
        },
      ];
    });
  }
}
