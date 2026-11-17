# Blindtest Anime — Décisions de conception

Validé le 2026-11-17.

## Cadre

- Site de blindtest de musiques d'anime, usage entre potes (pas de scaling public en v1).
- Pas de comptes : pseudo stocké dans le navigateur, historique des scores en local. Aucune donnée persistée côté serveur.
- Interface FR + EN (détection de la langue du navigateur).

## Stack & architecture

- Monorepo TypeScript (npm workspaces) :
  - `client/` — React + Vite
  - `server/` — Node + Socket.IO
  - `shared/` — types partagés (événements socket, modèles)
- **Serveur arbitre**, y compris en solo : tirage des musiques, chrono, validation des réponses (horodatage serveur). Le multi = N joueurs sur le même moteur.
- **Catalogue SQLite généré au build** (lecture seule) :
  - source : API AnimeThemes.moe (animes, thèmes, séries/franchises, fichiers audio/vidéo)
  - popularité : AniList (via les mappings externes d'AnimeThemes)
  - titres français : Wikidata (via les identifiants AniList / MyAnimeList)
  - aucun appel externe pendant une partie ; autocomplétion locale instantanée.
- **Proxy audio opaque** (`/api/audio/:token`) pour ne pas révéler le nom du fichier ; préchargement de l'extrait suivant. La vidéo de révélation est chargée directement depuis le CDN AnimeThemes.
- Sources de musiques abstraites (une source « AnimeThemes » en v1, une source « fichiers locaux » prévue pour les OST en v2).

## Hébergement

- Render, deux services :
  - front : static site (CDN, pas de mise en veille)
  - back : web service (WebSockets + proxy audio)
- Le front ping le back dès l'ouverture du site pour le réveiller (indicateur « Connexion au serveur… / Prêt »).
- Développement en local d'abord.

## Contenu & filtres

- Types : OP / ED / Insert songs. OST en v2.
- Filtres de partie : popularité (top 100 / 500 / 2000 / tout), type, plage d'années.
- Titre affiché selon la langue de l'interface : FR → EN → romaji (interface FR) ; EN → romaji (interface EN).

## Réponses

- Texte libre + autocomplétion.
- Normalisation : casse, accents, ponctuation ignorés ; titres romaji / anglais / français / alternatifs acceptés ; petite tolérance aux fautes de frappe.
- **La franchise suffit** pour valider.
- Bonus de précision (indépendants de la rapidité, uniquement si l'anime est correct) :
  - +25 saison exacte (proposé seulement si la franchise a plusieurs entrées)
  - +25 bon numéro d'OP/ED (champ facultatif)

## Modes de jeu

### Classique (v1)

- 15 s d'écoute (point de départ aléatoire dans la chanson) → 10 s de révélation / débrief (vidéo + titre + type + artiste) → 3 s de compte à rebours avec son de cloche.
- Score : de 200 pts (réponse instantanée) à 50 pts (dernière seconde), linéaire. Mauvaise réponse = 0.
- Essais illimités pendant les 15 s.
- 10 manches par défaut, réglable.
- En multi : tout le monde peut trouver, chacun selon sa rapidité.

### Progressif (v1, façon Songspot)

- Paliers d'écoute : 0,5 s → 1 s → 5 s → 15 s. 60 s au total par manche.
- Chaque joueur avance à son rythme : bouton « palier suivant », réécoute illimitée du palier en cours.
- 3 essais par palier ; après 3 erreurs, passage automatique au palier suivant. Au dernier palier, 3 erreurs = éliminé de la manche.
- Score selon le palier : 200 / 150 / 100 / 50 (+ bonus de précision).
- 0 pt si rien trouvé au bout de 60 s. Fin de manche quand tout le monde a trouvé/est éliminé ou à 60 s.

### Feuille de route

- Facile (QCM 4 choix)
- Artiste (trouver l'interprète)

## Multijoueur (v1.5)

- Room partageable par code ou lien ; l'hôte règle mode + filtres ; 8 joueurs max.
- Même extrait synchronisé pour tous.
- Classement temps réel sur le côté ; on voit qui a trouvé, pas la réponse.
- Reconnexion avec conservation du score.
- Room supprimée après 10 min vide.
- Rooms en mémoire (pas de persistance).

## Sons & design

- Effets sonores générés via Web Audio API (cloche, tic-tac, bonne/mauvaise réponse).
- Direction visuelle retenue : **Pastel Sakura** (maquette : https://claude.ai/artifact/HhiGcbNUEN4tR66xJ89jb4).
  - Fond prune `#1B1424`, surfaces `#241B30` / `#2A2035` / `#33284A`
  - Texte `#FFF4FA`, texte secondaire `#CDBCDA`
  - Accent rose `#FF9EC7`, lavande `#B9A6FF`, menthe `#8FF0C8` (succès)
  - Typo : Fredoka (titres), Nunito (texte)
  - Formes très arrondies (pilules, rayons 24–40 px), vinyle animé, barre de progression dégradée lavande → rose, avatars colorés.
