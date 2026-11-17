# Blindtest Anime

Blindtest de musiques d'anime (openings, endings, insert songs) à jouer seul ou entre potes.

- Décisions de conception : [docs/DECISIONS.md](docs/DECISIONS.md)

## Structure

| Dossier   | Rôle                                                      |
| --------- | --------------------------------------------------------- |
| `client/` | Front React + Vite + TypeScript (direction Pastel Sakura) |
| `server/` | Back Node + Fastify + Socket.IO                           |
| `shared/` | Types partagés (API, événements socket)                   |

## Démarrage

Prérequis : Node 22+.

```bash
npm install
npm run dev        # back sur :3001, front sur http://localhost:5173
```

## Scripts

| Commande            | Effet                                  |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Lance le back et le front en watch     |
| `npm run build`     | Build de production (server + client)  |
| `npm run typecheck` | Vérifie les types de tous les packages |
| `npm test`          | Lance les tests                        |
| `npm run lint`      | ESLint                                 |
| `npm run format`    | Prettier                               |
