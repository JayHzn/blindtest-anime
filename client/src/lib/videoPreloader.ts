import { apiUrl } from './server';

/** Nouvelles tentatives si le CDN vidéo refuse la requête (il limite les requêtes rapprochées). */
const RETRIES = 2;
const RETRY_DELAY_MS = 1500;

/**
 * Charge la vidéo de la révélation, directement depuis AnimeThemes (lien reçu avec
 * la révélation : la réponse est connue, rien à cacher) sans passer par notre serveur.
 * Le navigateur la télécharge en une seule requête : le CDN vidéo supporte mal les
 * requêtes rapprochées.
 */
export class VideoPreloader {
  private current: { round: number; element: HTMLVideoElement } | null = null;
  private retryTimer: number | null = null;
  private volume = 0.8;

  /**
   * Précharge la vidéo en se plaçant à `startAt` (début de l'extrait, en s) :
   * le navigateur télécharge alors la portion utile pour enchaîner sans coupure.
   */
  preload(round: number, url: string | null, startAt = 0): void {
    this.release();
    if (!url) return;
    const element = document.createElement('video');
    element.preload = 'auto';
    element.muted = true;
    element.playsInline = true;
    element.volume = this.volume;
    if (startAt > 0) {
      element.addEventListener(
        'loadedmetadata',
        () => {
          element.currentTime = Math.min(startAt, Math.max(0, element.duration - 1));
        },
        { once: true },
      );
    }
    // Lien direct (AnimeThemes) tel quel ; chemin relatif : notre serveur.
    const src = /^https?:\/\//.test(url) ? url : apiUrl(url);
    let attempts = 0;
    element.addEventListener('error', () => {
      if (attempts >= RETRIES || this.current?.element !== element) return;
      attempts++;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        if (this.current?.element !== element) return;
        element.src = src;
        element.load();
      }, RETRY_DELAY_MS);
    });
    element.src = src;
    element.load();
    this.current = { round, element };
  }

  /** L'élément vidéo préchargé pour cette manche (null s'il n'y en a pas). */
  get(round: number): HTMLVideoElement | null {
    return this.current?.round === round ? this.current.element : null;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.current) this.current.element.volume = volume;
  }

  /** Arrête la vidéo et libère la connexion. */
  release(): void {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (!this.current) return;
    const { element } = this.current;
    element.pause();
    element.remove();
    element.removeAttribute('src');
    element.load();
    this.current = null;
  }
}

/** La position (s) est-elle déjà téléchargée, avec une marge pour démarrer sans attendre ? */
export function isBuffered(element: HTMLMediaElement, position: number, marginS = 2): boolean {
  const { buffered } = element;
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= position && buffered.end(i) >= position + marginS) return true;
  }
  return false;
}
