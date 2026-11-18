import { createHmac } from 'node:crypto';

/** Relecture de la liste des chansons copiées (le script d'envoi l'enrichit). */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Miroir audio sur Cloudflare R2, servi par un Worker : le navigateur y lit l'audio
 * sans passer par notre serveur (dont la bande passante est limitée).
 *
 * Chaque fichier s'appelle `a/<empreinte>.ogg`, empreinte = HMAC(clé secrète, n° de
 * la chanson) : sans la clé (connue du serveur et du script d'envoi seulement), le
 * nom ne dit rien de la chanson. `index.json` liste les numéros des chansons copiées ;
 * les autres passent toujours par le proxy du serveur.
 */
export class AudioMirror {
  private themes = new Set<number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Nom du fichier d'une chanson sur R2. */
  static keyFor(secret: string, themeId: number): string {
    const digest = createHmac('sha256', secret).update(`theme:${themeId}`).digest('hex');
    return `a/${digest.slice(0, 24)}.ogg`;
  }

  /** Adresse publique de la chanson, ou null si elle n'est pas (encore) copiée. */
  urlFor(themeId: number): string | null {
    if (!this.themes.has(themeId)) return null;
    return `${this.baseUrl}/${AudioMirror.keyFor(this.secret, themeId)}`;
  }

  isMirrorUrl(url: string): boolean {
    return url.startsWith(`${this.baseUrl}/`);
  }

  get size(): number {
    return this.themes.size;
  }

  /** Charge la liste des chansons copiées ; en cas d'échec, garde la précédente. */
  async refresh(fetchImpl: typeof fetch = fetch): Promise<void> {
    try {
      const response = await fetchImpl(`${this.baseUrl}/index.json`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return;
      const body = (await response.json()) as { themes?: unknown };
      if (!Array.isArray(body.themes)) return;
      this.themes = new Set(body.themes.filter((id): id is number => Number.isInteger(id)));
    } catch {
      // Miroir injoignable : l'audio passe par le proxy, rien ne casse.
    }
  }

  /** Premier chargement, puis relecture régulière. */
  start(onLoaded?: (count: number) => void): void {
    void this.refresh().then(() => onLoaded?.(this.size));
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
