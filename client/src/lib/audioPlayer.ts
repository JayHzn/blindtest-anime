import { serverNow } from './clock';
import { apiUrl } from './server';

interface Track {
  url: string;
  element: HTMLAudioElement;
  /** Position de départ de l'extrait (s). */
  startTime: number;
}

/** Délai maximal de préchargement avant de déclarer l'audio injouable. */
const PRELOAD_TIMEOUT_MS = 15_000;
/** Marge au-delà de la durée d'un extrait : un son bloqué (pas encore chargé) ne le fait pas durer sans fin. */
const SNIPPET_STALL_MS = 2000;
/**
 * En dessous de ce retard, l'extrait part de sa position préchargée sans se
 * repositionner : un repositionnement jette le son déjà chargé et le navigateur
 * le recharge (mesuré : 0,7 s en local, 1 à 2 s en ligne) — bien pire que le retard.
 */
const RESYNC_THRESHOLD_S = 1;
/** Écart toléré avant de repositionner un extrait (évite un rechargement inutile). */
const SEEK_EPSILON_S = 0.05;

/** Place la lecture à `time` seulement si elle n'y est pas déjà (garde le son chargé). */
function seekTo(element: HTMLAudioElement, time: number): void {
  if (Math.abs(element.currentTime - time) > SEEK_EPSILON_S) element.currentTime = time;
}

/**
 * Lecture des extraits : préchargement à l'avance, démarrage synchronisé
 * sur l'heure serveur, fondu de sortie.
 */
export class AudioPlayer {
  private readonly tracks = new Map<number, Track>();
  private volume = 0.8;
  /** Incrémenté à chaque extrait : un nouvel extrait interrompt le précédent. */
  private snippetToken = 0;
  /** Appelé si le navigateur refuse la lecture faute de clic préalable (rechargement de page…). */
  onBlocked: (() => void) | null = null;

  private handlePlayError = (error: unknown): void => {
    if (error instanceof DOMException && error.name === 'NotAllowedError') this.onBlocked?.();
  };

  setVolume(volume: number): void {
    this.volume = volume;
    for (const track of this.tracks.values()) track.element.volume = volume;
  }

  /**
   * Précharge l'extrait d'une manche et se place au point de départ.
   * Résout `true` quand il est prêt à jouer, `false` en cas d'échec.
   */
  prepare(round: number, url: string, startRatio: number): Promise<boolean> {
    const existing = this.tracks.get(round);
    if (existing?.url === url) return Promise.resolve(existing.element.readyState >= 3);
    if (existing) this.release(round);

    const element = new Audio();
    element.preload = 'auto';
    element.volume = this.volume;
    const track: Track = { url, element, startTime: 0 };
    this.tracks.set(round, track);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        element.removeEventListener('loadedmetadata', onMetadata);
        element.removeEventListener('canplay', onCanPlay);
        element.removeEventListener('seeked', onCanPlay);
        element.removeEventListener('error', onError);
        resolve(ok);
      };
      const onMetadata = () => {
        const duration = Number.isFinite(element.duration) ? element.duration : 0;
        track.startTime = duration * startRatio;
        element.currentTime = track.startTime;
      };
      const onCanPlay = () => {
        // On attend d'être positionné au point de départ (après le seek).
        if (!element.seeking && element.readyState >= 3) finish(true);
      };
      const onError = () => finish(false);
      const timer = window.setTimeout(() => finish(false), PRELOAD_TIMEOUT_MS);

      element.addEventListener('loadedmetadata', onMetadata);
      element.addEventListener('canplay', onCanPlay);
      element.addEventListener('seeked', onCanPlay);
      element.addEventListener('error', onError);
      // Miroir audio (adresse complète) tel quel ; chemin relatif : notre serveur.
      element.src = /^https?:\/\//.test(url) ? url : apiUrl(url);
      element.load();
    });
  }

  /** Lance l'extrait au bon endroit, en rattrapant le retard depuis `startedAt` (heure serveur). */
  play(round: number, startedAt: number): void {
    this.releaseBefore(round);
    const track = this.tracks.get(round);
    if (!track) return;
    const lateBy = Math.max(0, serverNow() - startedAt) / 1000;
    // Petit retard (réseau) : on part tout de suite du point préchargé. Gros retard
    // (reconnexion en pleine écoute) : on rattrape l'extrait là où il en est.
    seekTo(track.element, track.startTime + (lateBy < RESYNC_THRESHOLD_S ? 0 : lateBy));
    track.element.volume = this.volume;
    // Lecture refusée : la manche continue, et le joueur peut réactiver le son.
    void track.element.play().catch(this.handlePlayError);
  }

  /**
   * Modes Progressif, Enchères, Plus ou moins : joue `durationMs` depuis le point de
   * départ, puis s'arrête. Résout quand l'extrait est fini (ou interrompu par un autre).
   * - `offsetMs` : reprend l'extrait en cours de route (arrivée en retard) ;
   * - `keepFrom` : garde les audios à partir de cette manche (Plus ou moins : la
   *   référence reste réécoutable), les plus anciens sont libérés.
   */
  playSnippet(
    round: number,
    durationMs: number,
    { offsetMs = 0, keepFrom = round }: { offsetMs?: number; keepFrom?: number } = {},
  ): Promise<void> {
    this.releaseBefore(keepFrom);
    const track = this.tracks.get(round);
    this.snippetToken++;
    const token = this.snippetToken;
    if (!track) return Promise.resolve();
    // Un seul extrait à la fois : celui d'une autre manche s'arrête.
    for (const other of this.tracks.values()) if (other !== track) other.element.pause();
    const { element } = track;
    const endAt = track.startTime + durationMs / 1000;
    const giveUpAt = performance.now() + durationMs - offsetMs + SNIPPET_STALL_MS;
    // Même règle que `play` : un petit retard ne vaut pas un rechargement du son.
    const offsetS = offsetMs / 1000 < RESYNC_THRESHOLD_S ? 0 : offsetMs / 1000;
    seekTo(element, track.startTime + offsetS);
    element.volume = this.volume;
    void element.play().catch(this.handlePlayError);

    return new Promise((resolve) => {
      // Vérifié à chaque image : arrêt à la bonne position, à ~16 ms près.
      const watch = () => {
        if (token !== this.snippetToken) return resolve();
        if (element.currentTime >= endAt || element.ended || performance.now() > giveUpAt) {
          element.pause();
          return resolve();
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    });
  }

  /** Point de départ de l'extrait (s), connu une fois l'audio préchargé. */
  startTime(round: number): number | null {
    return this.tracks.get(round)?.startTime ?? null;
  }

  /** Position de lecture actuelle (s), pour enchaîner sur la vidéo. */
  position(round: number): number | null {
    return this.tracks.get(round)?.element.currentTime ?? null;
  }

  /** Baisse progressivement le son puis met en pause. */
  fadeOut(round: number, durationMs = 500): void {
    const element = this.tracks.get(round)?.element;
    if (!element || element.paused) return;
    const startVolume = element.volume;
    const startedAt = performance.now();
    const step = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
      element.volume = startVolume * (1 - progress);
      if (progress < 1) requestAnimationFrame(step);
      else element.pause();
    };
    requestAnimationFrame(step);
  }

  stopAll(): void {
    for (const round of [...this.tracks.keys()]) this.release(round);
  }

  private releaseBefore(round: number): void {
    for (const previous of [...this.tracks.keys()]) {
      if (previous < round) this.release(previous);
    }
  }

  private release(round: number): void {
    const track = this.tracks.get(round);
    if (!track) return;
    track.element.pause();
    track.element.removeAttribute('src');
    track.element.load(); // libère la connexion réseau
    this.tracks.delete(round);
  }
}
