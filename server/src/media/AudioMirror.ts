import { createHmac } from 'node:crypto';

/** Relecture de la liste des chansons copiées (le script d'envoi l'enrichit). */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Nouvel essai après un échec : 1 min, puis le double à chaque fois, 30 min au plus. */
const RETRY_FIRST_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

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
  private stopped = false;
  /** Raison du dernier échec de lecture de la liste (null : dernière lecture réussie). */
  lastError: string | null = null;

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

  /**
   * Charge la liste des chansons copiées ; en cas d'échec, garde la précédente.
   * Renvoie null si c'est réussi, sinon la raison de l'échec.
   */
  async refresh(fetchImpl: typeof fetch = fetch): Promise<string | null> {
    try {
      const response = await fetchImpl(`${this.baseUrl}/index.json`, {
        headers: { 'user-agent': 'Anilind server', accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const text = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
        return `réponse ${response.status}${text ? ` (${text})` : ''}`;
      }
      const body = (await response.json()) as { themes?: unknown };
      if (!Array.isArray(body.themes)) return 'index.json sans liste « themes »';
      this.themes = new Set(body.themes.filter((id): id is number => Number.isInteger(id)));
      return null;
    } catch (error) {
      // Miroir injoignable : l'audio passe par le proxy, rien ne casse.
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      return `${(error as Error).name}: ${(error as Error).message}${cause ? ` (${cause.code ?? cause.message})` : ''}`;
    }
  }

  /**
   * Premier chargement, puis relecture régulière. En cas d'échec, la raison est
   * signalée et un nouvel essai a lieu bientôt (1 min, puis de plus en plus espacé).
   */
  start(log: { info(message: string): void; warn(message: string): void }): void {
    let retryMs = RETRY_FIRST_MS;
    const attempt = async () => {
      const failure = await this.refresh();
      this.lastError = failure;
      if (this.stopped) return;
      if (failure === null) {
        log.info(`Miroir audio : ${this.size} chansons copiées`);
        retryMs = RETRY_FIRST_MS;
        this.schedule(attempt, REFRESH_INTERVAL_MS);
      } else {
        log.warn(
          `Miroir audio injoignable (${failure}) : nouvel essai dans ${Math.round(retryMs / 1000)} s`,
        );
        this.schedule(attempt, retryMs);
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      }
    };
    void attempt();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(action: () => Promise<void>, delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void action(), delayMs);
    this.timer.unref();
  }
}
