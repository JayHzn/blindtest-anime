import { PLAYLIST } from '@blindtest/shared';
import { apiUrl } from './server';

/**
 * Aperçu de 5 s pendant la phase de choix : une seule chanson à la fois,
 * lue à partir du point de départ donné (fraction du morceau).
 */
export class PreviewPlayer {
  private element: HTMLAudioElement | null = null;
  private timer: number | null = null;
  private current: string | null = null;
  /** Appelé quand l'aperçu en cours change (clé de la chanson, ou null). */
  onChange: ((key: string | null) => void) | null = null;

  get playing(): string | null {
    return this.current;
  }

  play(key: string, url: string, startRatio: number, volume: number): void {
    this.stop();
    const element = new Audio();
    element.preload = 'auto';
    element.volume = volume;
    this.element = element;
    this.setCurrent(key);

    let started = false;
    element.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(element.duration) ? element.duration : 0;
      element.currentTime = duration * startRatio;
    });
    const start = () => {
      if (started || element.seeking || this.element !== element) return;
      started = true;
      void element.play().catch(() => this.stop());
      this.timer = window.setTimeout(() => this.stop(), PLAYLIST.previewMs);
    };
    element.addEventListener('seeked', start);
    element.addEventListener('canplay', start);
    element.addEventListener('error', () => {
      if (this.element === element) this.stop();
    });
    element.src = apiUrl(url);
    element.load();
  }

  setVolume(volume: number): void {
    if (this.element) this.element.volume = volume;
  }

  stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.element) {
      this.element.pause();
      this.element.removeAttribute('src');
      this.element.load();
      this.element = null;
    }
    this.setCurrent(null);
  }

  private setCurrent(key: string | null): void {
    if (this.current === key) return;
    this.current = key;
    this.onChange?.(key);
  }
}
