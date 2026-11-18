# Suivi du projet

## 2026-11-18

### Ce qui a été fait

**Modes de jeu**

- **Plus ou moins (v2)** — commits `dbe7ab9`, `2bc8034` : solo et multi, élimination, chaîne de chansons tirée selon l'écart de popularité. Écrans refaits à l'identique de la maquette et vérifiés avec Playwright (solo, rooms à 2 et 3, ordinateur et téléphone).
- **Imposteur (v2)** — commit `bb5e464` : style Undercover, 4 joueurs minimum, mots tapés, vote et revote, élimination, devinette de la chanson de l'imposteur. Chacun voit le titre de sa chanson ; durée du vote réglable par l'hôte. Maquette : https://claude.ai/artifact/DHKrGNmaYzFKQJXyiMA3Uz. Vérifié avec Playwright (room à 4, 5 manches).

**Corrections et améliorations** — commit `b98ee33`

- **Son instantané** : le serveur fixe un départ commun 0,5 s dans le futur, le « 3-2-1 » se prolonge jusque-là, puis chrono et son partent ensemble (mesuré : 0 à 2 ms, avant 1 à 2 s de silence en ligne).
- **Champ de réponse** : choisir une suggestion ne valide plus directement, la main passe au numéro d'OP/ED (validation directe si le numéro est déjà tapé). Anime à un seul opening et un seul ending : champ du numéro masqué, jamais de +25.

**Bande passante (Render gratuit, quota de quelques Go par mois)** — commit `8e3d13d`

- **Vidéo de révélation chargée directement chez AnimeThemes**, plus par notre serveur (elle représentait environ 80 % du trafic). Lien envoyé à la révélation, et plus tôt à qui a trouvé, est éliminé ou a abandonné (préchargement). Délai mesuré : 3 à 5 s pour qui n'a pas trouvé (jaquette et extrait en attendant).
- **Vidéos plus légères** : la synchro du catalogue préfère maintenant le 720p (même avec les crédits) au 1080p.
- **Miroir audio sur Cloudflare R2** :
  - bucket `anilind-audio`, servi par le Worker https://anilind-audio.anilind.workers.dev (dossier `mirror-worker/`) ;
  - noms de fichiers opaques (HMAC avec `MIRROR_SECRET`), liste `index.json` ;
  - script `npm run mirror:sync -w server -- --top 100|500|2000|all --parallel 4` ;
  - workflow GitHub « Miroir audio » (onglet Actions) : lancement manuel, et chaque lundi pour les nouvelles chansons ;
  - top 100 copié depuis le PC (578 chansons, 572 Mo) ; workflow lancé pour le top 2000 (6 159 chansons, ~7,5 Go sur 10 Go gratuits) — 1 058 chansons copiées au moment d'écrire ce suivi.
- **Testé en local** avec le miroir : tout l'audio vient de R2, son en 7 à 11 ms.

**Idées ajoutées** dans `docs/IDEES.md` (règles à trancher) : Quel est le bon OP ? (blindtest à l'envers), Chronologie, Likes et playlist (Spotify / YouTube Music).

**En fin de journée**

- **Miroir actif sur le site en ligne** (vérifié : tout l'audio d'une partie vient de R2, son en 2 à 9 ms). `/api/health` indique le nombre de chansons du miroir et la raison d'un éventuel échec (au début, la lecture de `index.json` échouait depuis Render ; réglé après l'ajout d'un en-tête `user-agent` et des nouveaux essais).
- **Règles du mode choisi** affichées dans une carte, dans la place libre de la grille des modes (solo et salon, visibles par tous).
- **Tests de bout en bout dans le dépôt** (`e2e/`, Playwright, hors des paquets installés par Render) : Classique (son avec le chrono, choix d'une suggestion), Plus ou moins (partie solo complète), Imposteur (manche à 4). Lancement : `cd e2e && npm install && npm run install-browser && npm test` (démarre le serveur et le site locaux si besoin ; catalogue et connexion Internet nécessaires).

### En cours

- **Workflow GitHub du top 2000** : vérifier qu'il se termine sans erreur (onglet Actions → « Miroir audio »), et la place utilisée sur R2 (tableau de bord Cloudflare → R2).

### À faire

1. **Clés du miroir** : `MIRROR_SECRET` (irremplaçable : sans elle, plus aucun fichier du miroir n'est retrouvable) est sauvegardée dans Render (`anilind-api` → Environment, valeur réaffichable) — vérifier qu'elle s'y affiche bien. Les clés R2 se recréent en 2 minutes dans Cloudflare si besoin. `server/.env.r2` n'existe que sur le PC de travail (dossier `Temp`, jamais commité).
2. **Vérifier que l'ancienne clé R2** (celle collée dans la conversation) est bien révoquée (Cloudflare → R2 → Manage R2 API Tokens).
3. **Tests réels à plusieurs** :
   - vidéo de révélation avec 6 à 8 joueurs sur le **même Wi-Fi** (le CDN d'AnimeThemes peut refuser des requêtes : la jaquette reste alors affichée) ;
   - 3 ou 4 joueurs sur des **connexions différentes** (4G par exemple).
4. **Partie sur iPhone** : l'audio du miroir est en Ogg (Opus), comme celui d'AnimeThemes avant ; seul Chrome a été testé. Vérifier que le son se lance sur Safari iOS.
5. **Test Imposteur de `e2e/`** : pas encore relancé depuis la correction de la langue des tests (`cd e2e && npx playwright test impostor.spec.ts`) ; les tests Classique et Plus ou moins passent.
6. **Mise en cache du Worker** : impossible sur une adresse `workers.dev` (il faudrait un nom de domaine) ; gain faible, laissé de côté.
7. **Surveiller la bande passante Render** (tableau de bord → Bandwidth) une fois le miroir actif.
8. **Maquette Imposteur** : le canevas n'a pas les deux dernières corrections (salon existant, carte « Ta chanson ») — l'accès en écriture avait été perdu ; le code, lui, les suit.
9. **Nouveaux modes** : trancher les règles de « Quel est le bon OP ? » et « Chronologie », puis maquette, puis implémentation.
10. **Likes et playlist** : commencer sans compte (likes dans le navigateur, export d'une liste pour Soundiiz ou TuneMyMusic).

### Questions en suspens

- **Retirer le passage de l'audio par le serveur une fois tout copié ?** Pas complètement : le miroir ne tient que le top 2000 dans les 10 Go gratuits (le catalogue entier ferait environ 16 Go), et le passage par le serveur sert de secours si un fichier du miroir ne se charge pas. Il ne coûte rien tant qu'il ne sert pas.
  - **Décidé le 2026-11-18 : on reste sur l'offre gratuite** (top 2000 sur R2 ; avec le réglage « Tout », les chansons au-delà passent par Render).
  - Tarifs R2 vérifiés le même jour (https://developers.cloudflare.com/r2/pricing/) : gratuit chaque mois 10 Go stockés, 1 million d'écritures, 10 millions de lectures, sortie de données toujours gratuite ; au-delà 0,015 $ par Go et par mois. Tout copier (`all` dans le workflow) coûterait environ 0,09 $ par mois, si la bande passante Render venait à manquer.
