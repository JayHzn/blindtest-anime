import { expect, test, type Page } from '@playwright/test';
import { openRoom } from './helpers';

const NAMES = ['Sakura', 'Kevin', 'Lea', 'Yuki'];
const songOf = (page: Page) => page.locator('[class*="_mysong_"] b').first().textContent();
const stepOf = async (page: Page) =>
  (await page
    .locator('[class*="_stepPill_"]')
    .first()
    .textContent()
    .catch(() => '')) ?? '';

test('Imposteur : une manche à 4, des indices à la révélation', async ({ browser }) => {
  const pages = await openRoom(browser, NAMES, async (host) => {
    await host.getByRole('radio', { name: /Imposteur/ }).click();
    await host.getByRole('radio', { name: '5', exact: true }).click();
  });
  const host = pages[0]!;
  await host.locator('[class*="_mysong_"]').first().waitFor({ timeout: 60_000 });
  const songs = await Promise.all(pages.map(songOf));
  const impostor = songs.findIndex((s) => songs.filter((t) => t === s).length === 1);
  expect(impostor, 'un seul joueur a une chanson différente').toBeGreaterThanOrEqual(0);

  let n = 0;
  for (let guard = 0; guard < 300; guard++) {
    const step = await stepOf(host);
    if (step.startsWith('Indices')) {
      for (const page of pages) {
        const input = page.locator('[class*="_input_"]');
        if (!(await input.count())) continue;
        await input.fill(`mot${n++}`);
        await page.getByRole('button', { name: 'Valider' }).click();
      }
    } else if (step.startsWith('Vote')) {
      for (const [i, page] of pages.entries()) {
        const target = i === impostor ? (impostor + 1) % NAMES.length : impostor;
        const ballot = page.locator('[class*="_ballot_"]:not([disabled])', {
          hasText: NAMES[target],
        });
        if (await ballot.count()) await ballot.first().click();
      }
    } else if (step.startsWith('Les civils')) {
      for (const page of pages) {
        const field = page.getByRole('combobox');
        if (!(await field.count())) continue;
        await field.fill(songs[impostor]!.slice(0, 6));
        await field.press('Enter');
      }
    } else if (step.startsWith('Fin de manche')) {
      break;
    }
    await host.waitForTimeout(400);
  }
  await expect(host.getByText('Les civils gagnent la manche')).toBeVisible();
  await expect(host.getByText('Chanson de l’imposteur')).toBeVisible();
  for (const page of pages) await page.context().close();
});
