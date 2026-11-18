import { expect, test } from '@playwright/test';
import { audioTraces, startSolo, traceAudio } from './helpers';

test('Classique : le son démarre avec le chrono, sans silence', async ({ page }) => {
  await traceAudio(page);
  await startSolo(page, /Classique/);
  await expect(page.getByText(/C.est quel anime/)).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await audioTraces(page)).at(0)?.playing ?? -1, { timeout: 5000 })
    .toBeGreaterThan(0);
  const [first] = await audioTraces(page);
  // Avant le départ programmé : 0,7 s de silence en local, 1 à 2 s en ligne.
  expect(first!.playing - first!.asked).toBeLessThan(250);
});

test("Classique : choisir une suggestion passe au numéro d'OP/ED sans valider", async ({
  page,
}) => {
  await startSolo(page, /Classique/);
  const field = page.getByRole('combobox');
  await field.waitFor({ timeout: 60_000 });
  await field.fill('naruto shipp');
  await page.getByRole('option').first().click();
  await expect(field).toHaveValue(/Naruto/);
  await expect(page.locator('input[inputmode="numeric"]')).toBeFocused();
  await page.keyboard.type('16');
  await page.keyboard.press('Enter');
  // Réponse envoyée : champ vidé (raté) ou manche trouvée.
  await expect(field.or(page.getByText('Bien joué !'))).toBeVisible();
  if (await field.isVisible()) await expect(field).toHaveValue('');
});
