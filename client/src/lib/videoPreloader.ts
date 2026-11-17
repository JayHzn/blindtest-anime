import { apiUrl } from './server';

/**
 * Précharge la vidéo de la révélation pendant l'écoute (URL opaque, rien
 * à voir dans l'onglet réseau). Le navigateur la télécharge en une seule
 * requête depuis le début : le CDN vidéo supporte mal les requêtes rapprochées.
 */
export class VideoPreloader {
  private current: { round: number; element: HTMLVideoElement } | null = null;
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
    element.src = apiUrl(url);
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
