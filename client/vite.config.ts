import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En dev, le front parle au back via le proxy Vite (même origine).
    // En prod, VITE_SERVER_URL pointe vers le web service Render.
    proxy: {
      '/api': SERVER,
      '/socket.io': { target: SERVER, ws: true },
    },
  },
  build: {
    target: 'es2022',
  },
});
