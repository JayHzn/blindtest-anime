/**
 * Miroir audio d'Anilind : sert les fichiers du bucket R2 (offre gratuite : sortie
 * de données gratuite, 100 000 requêtes par jour), sans passer par le serveur du jeu.
 *
 * - `a/<empreinte>.ogg` : une chanson (nom opaque, cache permanent) ; requêtes par
 *   plage (`Range`) gérées, le navigateur en a besoin pour se placer dans le morceau ;
 * - `index.json` : la liste des chansons copiées, lue par le serveur du jeu.
 * Tout le reste du bucket (s'il y en a) n'est jamais servi.
 */
const AUDIO_KEY = /^a\/[0-9a-f]{24}\.ogg$/;

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Méthode non autorisée', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const isIndex = key === 'index.json';
    if (!isIndex && !AUDIO_KEY.test(key)) return new Response('Introuvable', { status: 404 });

    const object = await env.AUDIO.get(key, { range: request.headers, onlyIf: request.headers });
    if (object === null) return new Response('Introuvable', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('access-control-allow-origin', '*');
    headers.set('cache-control', isIndex ? 'no-cache' : 'public, max-age=31536000, immutable');

    // Condition `If-None-Match` / `If-Modified-Since` remplie : rien à renvoyer.
    if (!('body' in object)) return new Response(null, { status: 304, headers });

    const range = object.range;
    if (range && request.headers.has('range')) {
      const size = object.size;
      const start = 'suffix' in range ? size - range.suffix : (range.offset ?? 0);
      const length = 'suffix' in range ? range.suffix : (range.length ?? size - start);
      headers.set('content-range', `bytes ${start}-${start + length - 1}/${size}`);
      headers.set('content-length', String(length));
      return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers });
    }
    headers.set('content-length', String(object.size));
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  },
};
