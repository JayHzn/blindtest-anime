import type { Browser, Page } from '@playwright/test';

interface AudioTrace {
  asked: number;
  playing: number;
}

/** Note l'instant où chaque `<audio>` est lancé, et celui où le son démarre vraiment. */
export async function traceAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __audio: { asked: number; playing: number }[] };
    w.__audio = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (this.tagName === 'AUDIO') {
        const entry = { asked: performance.now(), playing: -1 };
        w.__audio.push(entry);
        this.addEventListener('playing', () => (entry.playing = performance.now()), {
          once: true,
        });
      }
      return play.apply(this, args);
    };
  });
}

export function audioTraces(page: Page): Promise<AudioTrace[]> {
  return page.evaluate(() => (window as unknown as { __audio: AudioTrace[] }).__audio);
}

export async function startSolo(page: Page, mode: RegExp): Promise<void> {
  await page.goto('/');
  await page.getByLabel(/pseudo/i).fill('Testeur');
  await page.getByRole('button', { name: 'Jouer en solo' }).click();
  await page.getByRole('radio', { name: mode }).click();
  await page.getByRole('button', { name: 'Lancer la partie' }).click();
}

/** Room à plusieurs : l'hôte crée et règle, les autres rejoignent et sont prêts, puis on lance. */
export async function openRoom(
  browser: Browser,
  names: string[],
  setup: (host: Page) => Promise<void>,
): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < names.length; i++) {
    // Contextes créés à la main : ils ne reprennent pas les options du fichier de config.
    const context = await browser.newContext({
      baseURL: 'http://localhost:5173',
      locale: 'fr-FR',
    });
    pages.push(await context.newPage());
  }
  const host = pages[0]!;
  await host.goto('/');
  await host.getByLabel(/pseudo/i).fill(names[0]!);
  await host.getByRole('button', { name: 'Créer une room' }).click();
  await host.waitForURL(/room=/);
  const code = new URL(host.url()).searchParams.get('room');
  await setup(host);
  for (const [i, page] of pages.slice(1).entries()) {
    await page.goto(`/?room=${code}`);
    await page.getByLabel(/pseudo/i).fill(names[i + 1]!);
    await page
      .getByRole('button', { name: /Rejoindre/ })
      .first()
      .click();
    await page.getByRole('button', { name: /Je suis prêt/ }).click();
  }
  await host.getByRole('button', { name: 'Lancer la partie' }).click();
  return pages;
}
