import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Le package shared est consommé en source TypeScript : on l'embarque dans le bundle.
  noExternal: ['@blindtest/shared'],
});
