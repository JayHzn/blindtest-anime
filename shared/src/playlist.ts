/**
 * Mode Playlist des joueurs (v2) : chaque joueur choisit des chansons en secret,
 * puis tout le monde les joue. Celui qui a choisi une chanson n'y répond pas et
 * marque des points pour chaque joueur qui ne la trouve pas.
 */

export const PLAYLIST = {
  minPlayers: 3,
  songsMin: 1,
  songsMax: 10,
  songsDefault: 5,
  /** Points de qui a choisi la chanson, par joueur qui ne l'a pas trouvée (si au moins un l'a trouvée). */
  chooserPointsPerPlayer: 50,
  /** Bonus de qui trouve une chanson choisie par un joueur. */
  foundBonus: 50,
  /** Bonus « Devine qui l'a choisie ». */
  guessBonus: 50,
  /** Fenêtre pour deviner qui a choisi la chanson une fois que tout le monde l'a trouvée. */
  guessWindowMs: 7000,
  /** Aperçu pendant la phase de choix. */
  previewMs: 5000,
  /** Point de départ de l'aperçu (fraction du morceau). */
  previewStartRatio: 0.25,
} as const;

/** Durée de la phase de choix : 60 s jusqu'à 5 chansons, puis +6 s par chanson (90 s pour 10). */
export function pickingDurationMs(songsPerPlayer: number): number {
  const extra = Math.max(0, songsPerPlayer - 5);
  return (60 + extra * 6) * 1000;
}

/**
 * Points de qui a choisi la chanson pour une manche.
 * Tout le monde trouve, ou personne : 0. Sinon : +50 par joueur qui n'a pas trouvé.
 */
export function chooserPoints(answerers: number, found: number): number {
  if (answerers <= 0 || found <= 0 || found >= answerers) return 0;
  return (answerers - found) * PLAYLIST.chooserPointsPerPlayer;
}

/** Une chanson choisie (`playerId`) ou complétée au hasard (`playerId: null`). */
export interface PlaylistPick {
  playerId: string | null;
  themeId: number;
}

/** Une manche de la playlist : la chanson et qui l'a choisie (vide : tirée au hasard). */
export interface PlaylistRound {
  themeId: number;
  choosers: string[];
}

/**
 * Construit l'ordre de jeu : toutes les chansons choisies sont jouées, une
 * chanson choisie par plusieurs joueurs une seule fois (elle compte pour chacun),
 * dans un ordre aléatoire qui évite, si possible, deux chansons du même joueur
 * à la suite.
 */
export function drawPlaylist(
  picks: PlaylistPick[],
  random: () => number = Math.random,
): PlaylistRound[] {
  const byTheme = new Map<number, Set<string>>();
  for (const pick of picks) {
    const choosers = byTheme.get(pick.themeId) ?? new Set<string>();
    if (pick.playerId) choosers.add(pick.playerId);
    byTheme.set(pick.themeId, choosers);
  }
  const rounds: PlaylistRound[] = [...byTheme].map(([themeId, choosers]) => ({
    themeId,
    choosers: [...choosers].sort((a, b) => a.localeCompare(b)),
  }));

  // Mélange de Fisher-Yates
  for (let i = rounds.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rounds[i], rounds[j]] = [rounds[j]!, rounds[i]!];
  }
  return spreadChoosers(rounds);
}

/**
 * Reprend l'ordre mélangé en évitant deux manches de suite d'un même joueur :
 * on garde l'ordre du hasard, sauf quand un joueur a tant de chansons restantes
 * qu'il faut le placer maintenant pour pouvoir encore les espacer.
 */
function spreadChoosers(shuffled: PlaylistRound[]): PlaylistRound[] {
  const remainingOf = new Map<string, number>();
  for (const round of shuffled) {
    for (const id of round.choosers) remainingOf.set(id, (remainingOf.get(id) ?? 0) + 1);
  }
  const pool = [...shuffled];
  const ordered: PlaylistRound[] = [];
  while (pool.length > 0) {
    const previous = ordered.at(-1);
    const candidates = pool.filter((round) => !previous || !shareChooser(round, previous));
    const urgent = mostUrgentChooser(remainingOf, pool.length);
    const next =
      (urgent && candidates.find((round) => round.choosers.includes(urgent))) ||
      candidates[0] ||
      pool[0]!;
    pool.splice(pool.indexOf(next), 1);
    for (const id of next.choosers) remainingOf.set(id, remainingOf.get(id)! - 1);
    ordered.push(next);
  }
  return ordered;
}

function shareChooser(a: PlaylistRound, b: PlaylistRound): boolean {
  return a.choosers.some((id) => b.choosers.includes(id));
}

/** Le joueur qui a plus de la moitié des manches restantes, s'il y en a un. */
function mostUrgentChooser(remainingOf: Map<string, number>, left: number): string | null {
  let urgent: string | null = null;
  let best = 0;
  for (const [id, count] of remainingOf) {
    if (count * 2 > left && count > best) {
      urgent = id;
      best = count;
    }
  }
  return urgent;
}

/** Une chanson proposée pendant la phase de choix (jeton opaque propre au joueur). */
export interface PlaylistSong {
  token: string;
  type: 'OP' | 'ED' | 'IN';
  sequence: number;
  song: string | null;
  artists: string | null;
}

/** Une chanson de sa propre playlist (affichage seulement). */
export interface PickedSong {
  token: string;
  anime: { fr: string; en: string };
  type: 'OP' | 'ED' | 'IN';
  sequence: number;
  song: string | null;
}

/** Phase de choix, telle que la voit un joueur. */
export interface PickingState {
  endsAt: number;
  songsPerPlayer: number;
  /** Ses propres choix (jamais ceux des autres). */
  mine: PickedSong[];
  /** Avancement de chacun : seulement des nombres. */
  progress: { playerId: string; count: number }[];
}

export type PlaylistSongsResponse = { ok: true; songs: PlaylistSong[] } | { ok: false };

export type PlaylistPickError = 'not_picking' | 'invalid' | 'full' | 'duplicate';
export type PlaylistPickResponse =
  { ok: true; mine: PickedSong[] } | { ok: false; error: PlaylistPickError };

/** Aperçu de 5 s : audio opaque et point de départ. */
export interface PlaylistPreview {
  url: string;
  startRatio: number;
}

/** Infos du mode Playlist à la révélation d'une manche. */
export interface PlaylistReveal {
  /** Qui a choisi la chanson (vide : tirée au hasard). */
  choosers: { id: string; pseudo: string }[];
  /** Joueurs qui pouvaient répondre (hors joueurs qui l'ont choisie). */
  answerers: number;
  found: number;
  /** Points gagnés par chaque joueur qui l'a choisie. */
  chooserPoints: number;
  /** Paris « Devine qui l'a choisie » : `guess` null = « personne, tirée au hasard ». */
  guesses: { playerId: string; guess: string | null; correct: boolean }[];
}
