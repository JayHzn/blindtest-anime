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
  - source : API **GraphQL** AnimeThemes (`https://rs.animethemes.moe/graphql`, 90 req/min) — l'ancienne API JSON:API (`api.animethemes.moe`) est dépréciée et ne répond plus ;
  - popularité : AniList (via les mappings externes d'AnimeThemes)
  - titres français : Wikidata (propriété P8729 = ID AniList ; P179 = série parente), libellés « saison N de X » reformulés en « X — Saison N »
  - franchise = la plus grande série AnimeThemes de l'anime, sinon l'anime seul ;
  - musique retenue par thème : version originale (pas de groupe doublage), première version non NSFW, vidéo préférée sans scènes d'épisode, sans crédits, en 720p ;
  - aucun appel externe pendant une partie ;
  - autocomplétion **dans le navigateur** : le serveur envoie une fois l'index des titres (`/api/titles`, compressé, ETag), la recherche tourne côté client sans requête réseau par frappe ; le serveur revalide toujours la réponse ;
  - le catalogue contient les métadonnées et les liens, jamais les fichiers audio ;
  - un build qui échoue (ex. API AnimeThemes indisponible) n'écrase jamais le catalogue existant.
- **Audio** :
  - **Développement local (étapes 1 à 5)** : proxy audio opaque (`/api/audio/:token`) vers le CDN AnimeThemes, pour ne pas révéler le nom du fichier.
  - **Déploiement (étape 6)** : miroir audio sur Cloudflare R2.
    - Script au build : téléchargement du catalogue joué (top 2000 minimum), réencodage en Opus 96 kbps, noms de fichiers aléatoires.
    - Le navigateur lit les fichiers via un Cloudflare Worker branché sur R2, sans passer par notre serveur. L'adresse publique `*.r2.dev` est limitée en débit et réservée au dev, donc on ne l'utilise pas.
    - Raisons : ne plus dépendre d'AnimeThemes (panne ou fermeture), fichiers environ 3 fois plus légers, coût nul dans l'offre gratuite.
    - Téléchargement en douceur, sans surcharger AnimeThemes.
    - Réhébergement acceptable pour un usage entre potes, à revoir si le site devient public.
  - Volume déjà normalisé par AnimeThemes (−16 LUFS, vérifié sur 14 fichiers) : aucune normalisation à faire.
  - **Chargement côté client** :
    - préchargement des **2 chansons suivantes** ;
    - le son est **décodé à l'avance** (Web Audio, `AudioBuffer`), pour un démarrage instantané et précis ;
    - connexion ouverte vers le serveur des sons dès l'arrivée sur le site (`preconnect`) ;
    - fichiers à noms aléatoires servis avec un **cache permanent** (`Cache-Control: immutable`).
  - **Découpage en morceaux de 5 s** (miroir R2, à confirmer par un test) :
    - chaque chanson est encodée une seule fois, puis découpée en morceaux de 5 s ;
    - le client ne charge que les morceaux couvrant l'extrait (environ 200 Ko au lieu d'environ 1 Mo), puis les recolle avant de jouer ;
    - à vérifier : aucun clic ni blanc audible aux jonctions. En cas d'échec : chanson entière (environ 1 Mo).
  - Si le préchargement échoue, le client prévient le serveur, qui tire une autre chanson avant le début de la manche. Si toutes les sources sont indisponibles : message « Musiques indisponibles, réessaie plus tard ».
- **Vidéo de révélation** : chargée directement depuis le CDN AnimeThemes, sans miroir (trop volumineux). Si elle ne charge pas : jaquette + titre à la place.
- Sources de musiques abstraites : « AnimeThemes » (dev), « miroir R2 » (déploiement), « fichiers locaux » prévue pour les OST en v2.

## Hébergement

- Render, deux services :
  - front : static site (CDN, pas de mise en veille)
  - back : web service (WebSockets ; proxy audio uniquement en dev)
- Cloudflare R2 : stockage du miroir audio, indépendant du serveur (survit aux redémarrages et redéploiements de Render, qui n'a pas de disque persistant en gratuit).
  - Offre gratuite : 10 Go, bande passante sortante gratuite. Besoin estimé : environ 2 Go.
  - Une carte bancaire peut être demandée à l'activation (vérification, aucun prélèvement dans l'offre gratuite).
  - Fichiers servis par un Cloudflare Worker (offre gratuite : 100 000 requêtes par jour).
  - Tarifs à revérifier sur la page officielle au moment de l'étape 6.
- Le front ping le back dès l'ouverture du site pour le réveiller (indicateur « Connexion au serveur… / Prêt »).
- Développement en local d'abord.

## Contenu & filtres

- Types : OP / ED. OST en v2.
  - Insert songs : AnimeThemes les référence (type `IN`, 153 au 2026-11-17) mais sans aucun fichier audio ni vidéo. Le type est prévu dans le code et sera jouable dès qu'une source les fournira (AnimeThemes plus tard, ou fichiers locaux avec les OST en v2).
- Catalogue au 2026-11-17 : 13 855 musiques, 4 900 animes, 3 000 franchises, base de 4,3 Mo, index des titres de 192 Ko (brotli). Titre français pour 47 % du top 100 (repli sur l'anglais sinon).
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
- Détails du moteur (étape 2) :
  - point de départ tiré entre 0 et 60 % du morceau (envoyé en fraction, le client calcule la position) ;
  - l'audio de la manche N+1 est envoyé au début de l'écoute de la manche N (préchargement) ;
  - après le compte à rebours, le serveur attend que chaque joueur signale son audio prêt, 10 s au maximum, puis démarre quand même ;
  - quand tous les joueurs connectés ont trouvé, la révélation arrive tout de suite ;
  - 5 musiques de rechange tirées en plus ; un audio qui ne charge pas est remplacé tant que la manche n'a pas commencé ;
  - la vidéo n'est envoyée qu'à la révélation (son URL contient le nom de l'anime).

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
- Même extrait synchronisé pour tous :
  - le serveur envoie la chanson suivante dès le début de la révélation (13 s de préchargement) ;
  - chaque client confirme « prêt » une fois le son chargé et décodé ;
  - le serveur fixe une **heure de départ commune** (avec environ 0,5 s d'avance), et chaque client corrige l'écart de son horloge avec celle du serveur, mesuré par des pings réguliers ;
  - retardataire : on attend au maximum 3 s de plus, puis la manche démarre. Il démarre dès que son son est prêt, avec son propre chrono, sans pénalité ;
  - temps de réponse calculé par le serveur à partir de l'heure de départ qu'il a fixée.
- Première chanson :
  - bouton « Je suis prêt » dans le lobby (débloque le son, que les navigateurs coupent sans clic préalable) ;
  - au lancement, le serveur envoie les chansons 1 et 2, chargées pendant un écran d'intro de 5 s (mode, manches, joueurs, puis 3-2-1).
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
