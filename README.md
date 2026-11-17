# Blindtest Anime

Blindtest de musiques d'anime (openings et endings) à jouer seul ou entre potes :
mode Classique (15 s, plus tu es rapide plus tu marques) et mode Progressif
(0,5 s → 1 s → 5 s → 15 s), en solo ou dans une room jusqu'à 8 joueurs.

- Décisions de conception : [docs/DECISIONS.md](docs/DECISIONS.md)
- Musiques et vidéos : [AnimeThemes.moe](https://animethemes.moe) ; popularité et jaquettes : [AniList](https://anilist.co) ; titres français : [Wikidata](https://www.wikidata.org)

## Structure

| Dossier   | Rôle                                                      |
| --------- | --------------------------------------------------------- |
| `client/` | Front React + Vite + TypeScript (direction Pastel Sakura) |
| `server/` | Back Node + Fastify + Socket.IO + catalogue SQLite        |
| `shared/` | Types et logique partagés (API, événements, recherche)    |

## Démarrage

Prérequis : Node 22+.

```bash
npm install
npm run catalogue:sync -w server   # génère server/data/catalogue.db (~5 min)
npm run dev                        # back sur :3001, front sur http://localhost:5173
```

## Scripts

| Commande                                         | Effet                                                  |
| ------------------------------------------------ | ------------------------------------------------------ |
| `npm run dev`                                    | Lance le back et le front en watch                     |
| `npm run build`                                  | Build de production (server + client)                  |
| `npm run typecheck`                              | Vérifie les types de tous les packages                 |
| `npm test`                                       | Lance les tests                                        |
| `npm run lint` / `npm run format`                | ESLint / Prettier                                      |
| `npm run catalogue:sync -w server [-- --cached]` | Synchro du catalogue (`--cached` : réutilise les API)  |
| `npm run catalogue:check -w server`              | Diagnostic du catalogue (taille, vitesse de recherche) |
| `npm run smoke -w server`                        | Joue une manche contre un serveur qui tourne           |

## Mise en ligne (Render)

Le fichier [`render.yaml`](render.yaml) décrit deux services gratuits :

| Service               | Adresse                                  | Rôle                                  |
| --------------------- | ---------------------------------------- | ------------------------------------- |
| `blindtest-anime`     | https://blindtest-anime.onrender.com     | Site statique (CDN, jamais en veille) |
| `blindtest-anime-api` | https://blindtest-anime-api.onrender.com | API, WebSockets, proxy audio/vidéo    |

1. Sur Render : **New → Blueprint**, choisir ce dépôt GitHub, valider.
2. Premier build du serveur : environ 5 min (génération du catalogue).
3. Si Render attribue une autre adresse (nom pris), corriger `CLIENT_ORIGIN`
   (serveur) et `VITE_SERVER_URL` (site) dans le tableau de bord, puis redéployer.

Chaque `git push` sur `main` redéploie automatiquement. Le serveur gratuit se
met en veille après 15 min sans visite : le site le réveille dès l'ouverture
(environ 1 min au premier chargement).
