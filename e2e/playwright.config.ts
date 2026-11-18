import { defineConfig, devices } from '@playwright/test';

/**
 * Parties complètes dans Chromium, contre le serveur et le site lancés en local
 * (`npm run dev` à la racine, démarré ici s'il ne tourne pas déjà).
 * Prérequis : le catalogue (`npm run catalogue:sync -w server`) et une connexion
 * Internet (l'audio et la vidéo viennent d'AnimeThemes ou du miroir R2).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:5173',
    // Le site suit la langue du navigateur : les tests visent les textes français.
    locale: 'fr-FR',
    viewport: { width: 1280, height: 860 },
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'npm run dev',
    cwd: '..',
    url: 'http://localhost:5173/api/health',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
