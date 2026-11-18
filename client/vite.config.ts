import { defineConfig, loadEnv, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = 'http://localhost:3001';

/**
 * Ouvre la connexion vers le miroir audio dès l'arrivée sur le site (DNS, TLS),
 * pour que la première chanson démarre plus vite. Adresse : `VITE_MIRROR_URL`
 * (rien en dev si elle n'est pas définie). Les balises `<audio>` font des requêtes
 * sans CORS : pas d'attribut `crossorigin`.
 */
function preconnectMirror(mirrorUrl: string | undefined): Plugin {
  return {
    name: 'anilind-preconnect-mirror',
    transformIndexHtml() {
      if (!mirrorUrl?.trim()) return [];
      const origin = new URL(mirrorUrl.trim()).origin;
      const tags: HtmlTagDescriptor[] = [
        { tag: 'link', attrs: { rel: 'preconnect', href: origin }, injectTo: 'head' },
        // Repli : le DNS reste en cache plus longtemps qu'une connexion inutilisée.
        { tag: 'link', attrs: { rel: 'dns-prefetch', href: origin }, injectTo: 'head' },
      ];
      return tags;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), preconnectMirror(env.VITE_MIRROR_URL)],
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
  };
});
