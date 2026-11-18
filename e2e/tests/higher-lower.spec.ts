import { expect, test } from '@playwright/test';
import { startSolo } from './helpers';

test("Plus ou moins : une partie solo jusqu'à l'écran de fin", async ({ page }) => {
  await startSolo(page, /Plus ou moins/);
  const choices = page.locator('[class*="_choice_"]:not([disabled])');
  const verdict = page.locator('[class*="_verdictTitle_"]');
  for (let tour = 1; tour <= 30; tour++) {
    await choices.first().waitFor({ timeout: 60_000 });
    await choices.nth(tour % 2).click();
    await verdict.waitFor({ timeout: 40_000 });
    if ((await verdict.textContent())?.startsWith('Raté')) break;
    await verdict.waitFor({ state: 'detached', timeout: 20_000 });
  }
  await expect(page.getByText('Série terminée')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Rejouer' })).toBeVisible();
});
