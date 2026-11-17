# Anilind (blindtest anime) — Décisions de conception

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
- **Vidéo de révélation** : affichée seulement à la révélation, mais **préchargée pendant l'écoute** via le proxy, derrière une URL opaque (`/api/video/:token`, envoyée avec `round:start`). Pas de miroir (trop volumineux). Tant qu'elle charge, ou si elle échoue : **jaquette AniList** (fond flouté à sa couleur dominante), l'extrait continue. Jaquette disponible pour 4 894 animes sur 4 900, envoyée seulement à la révélation.
  - Constaté le 2026-11-17 : le CDN vidéo AnimeThemes (`v.animethemes.moe`) limite très fortement les requêtes (503 HTML au-delà d'environ une toutes les 2-3 s ; Chrome bloque alors la vidéo avec `ERR_BLOCKED_BY_ORB`). Le CDN audio n'a pas cette limite. Le proxy réessaie donc les 503 vidéo (8 essais espacés de 1,5 s), et le navigateur ne fait que quelques requêtes grâce au préchargement.
  - La vidéo est préchargée à la position que l'extrait aura en fin d'écoute ; à la révélation elle reprend à la position exacte de l'extrait (ou 1,5 s plus loin le temps de charger), pour que la musique continue sans coupure. Mesuré : vidéo jouée entre 0 et 1 s après la révélation, 5 fois sur 5.
  - Version choisie : sans scènes d'épisode, sans crédits, puis la plus légère (720p : 45 %, 1080p : 35 %, 480p : 9 % du catalogue ; 10 à 40 Mo par vidéo).
  - **Coût en bande passante** : chaque vidéo transite par le serveur (10 à 40 Mo par manche et par joueur). À reprendre à l'étape 6 (quota Render, éventuel cache partagé entre joueurs d'une même room).
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
- Mise en ligne (étape 6), décidée le 2026-11-17 : **en deux temps**.
  1. Render d'abord, avec le proxy audio/vidéo vers AnimeThemes (déjà testé), pour jouer tout de suite.
  2. Miroir audio R2 + Worker ensuite.
  - Nom du site : **Anilind** (choisi le 2026-11-17).
  - Blueprint `render.yaml` : `anilind` (static site, https://anilind.onrender.com) et `anilind-api` (web service, Francfort, https://anilind-api.onrender.com), adresses fixées dans la config (noms libres au 2026-11-17).
  - Catalogue généré au build du serveur (~5 min) ; un build qui échoue laisse la version en ligne.
  - Code publié sur le dépôt GitHub public `JayHzn/blindtest-anime` (aucun secret dans le dépôt).

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
  - la vidéo n'est jamais envoyée en clair (son URL contient le nom de l'anime) : voir « Vidéo de révélation ».

### Progressif (v1, façon Songspot)

- Paliers d'écoute : 0,5 s → 1 s → 5 s → 15 s. 60 s au total par manche.
- Chaque joueur avance à son rythme : bouton « palier suivant », réécoute illimitée du palier en cours.
- 3 essais par palier ; après 3 erreurs, passage automatique au palier suivant. Au dernier palier, 3 erreurs = éliminé de la manche.
- Score selon le palier : 200 / 150 / 100 / 50 (+ bonus de précision).
- 0 pt si rien trouvé au bout de 60 s. Fin de manche quand tout le monde a trouvé/est éliminé ou à 60 s.
- Détails (étape 4) :
  - le premier palier est joué automatiquement au début de l'écoute ; le palier suivant (bouton, ou 3 erreurs) est joué automatiquement aussi ;
  - même point de départ tiré au hasard qu'en Classique (0 à 60 % du morceau) : chaque palier rejoue l'extrait depuis ce point, en plus long ;
  - le serveur compte le palier atteint (le barème en dépend) ; le navigateur coupe l'extrait à la bonne durée. Un joueur qui bidouille son navigateur pourrait écouter plus longtemps : acceptable entre potes ;
  - à la révélation, la vidéo reprend là où le dernier extrait s'est arrêté ;
  - au dernier palier, le bouton « Palier suivant » devient **« Abandonner »** : le joueur qui ne sait pas passe la manche (0 point) et compte comme ayant fini (révélation immédiate en solo, dès que tout le monde a fini en multi).

### Playlist des joueurs (v2, multi uniquement)

Validé le 2026-11-17 (maquette : https://claude.ai/artifact/2uaSVC9K12YCnM4VXEiCVA).

- **Principe** : chaque joueur choisit des chansons en secret, puis tout le monde les joue avec les règles du Classique (15 s, de 200 à 50 points, bonus de précision). Pas de variante Progressive.
- **3 joueurs minimum** au lancement.
- **Réglage** : chansons par joueur, de 1 à 10 (5 par défaut). Pas de réglage de manches : toutes les chansons choisies sont jouées.
- **Phase de choix** :
  - 60 s jusqu'à 5 chansons, +6 s par chanson au-delà (90 s pour 10) ;
  - recherche avec l'autocomplétion des réponses, puis liste des chansons de l'anime (OP puis ED, filtre texte pour les longues listes) ;
  - choix libre dans tout le catalogue : seul le filtre de type (OP/ED) s'applique aux choix ;
  - aperçu de 5 s au clic, à partir de 25 % du morceau, un seul à la fois ;
  - chacun voit ses choix et seulement le nombre de chansons des autres ;
  - quand tout le monde a rempli sa playlist, la partie démarre 3 s plus tard ;
  - temps écoulé : les chansons manquantes sont tirées au hasard avec les filtres de la room, jamais dans une série déjà choisie.
- **Ordre de jeu** : mélange aléatoire qui évite, si possible, deux chansons du même joueur à la suite. Une chanson choisie par plusieurs joueurs est jouée une seule fois, et compte pour chacun d'eux.
- **Joueur dont la chanson passe** :
  - il écoute sans répondre : écran « C'est ta chanson ! », avec en direct qui la trouve ;
  - il gagne **+50 par joueur qui ne la trouve pas**, mais 0 si tout le monde la trouve ou si personne ne la trouve.
- **Joueurs qui la trouvent** :
  - points normaux, **+50 « Chanson d'un joueur »** (0 pour une chanson tirée au hasard) ;
  - **« Devine qui l'a choisie »** : proposé dès qu'on a trouvé, un seul pari parmi les autres joueurs ou « Personne (tirée au hasard) », **+50** si c'est juste ;
  - quand tous ceux qui répondent ont trouvé, une fenêtre de **7 s** reste pour deviner, puis la révélation arrive (plus tôt si tout le monde a parié).
- **Révélation** : « Choisi par Kevin : 2 joueurs sur 4 ont trouvé », ou « Chanson tirée au hasard ».
- **Secret** (rien ne trahit qui a choisi la chanson avant la révélation) :
  - jetons de chanson opaques et propres à chaque joueur pendant le choix ;
  - pendant la manche, les autres ne voient ni les coches « a trouvé » ni les scores bouger : un compteur anonyme (« 2 joueurs ont trouvé ») et des scores mis à jour à la révélation ;
  - seul le joueur qui a choisi la chanson voit qui la trouve ;
  - le bonus « Chanson d'un joueur » n'est ajouté qu'à la révélation (sinon il indiquerait si la chanson a été tirée au hasard).
- **Départs** : déconnexion, le joueur garde ses points et ses chansons ; départ volontaire pendant le choix, ses chansons sont retirées ; départ pendant la partie, ses chansons restantes sont jouées comme des chansons sans joueur.

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
- Mise en œuvre (étape 5) :
  - identité : le navigateur garde une clé secrète (localStorage) envoyée à la connexion Socket.IO ; le serveur en dérive l'identifiant public (empreinte SHA-256), si bien qu'un joueur retrouve sa room, sa partie et son score après une coupure ou un rechargement ; la clé n'est jamais montrée aux autres ;
  - tous les événements de jeu sont envoyés joueur par joueur (salon personnel), ce qui rend la reconnexion automatique ; un joueur qui (re)vient reçoit l'état complet (`game:state`), l'audio déjà annoncé et la révélation en cours ;
  - préchargement : la chanson suivante part au début de l'écoute de la manche en cours (plus tôt que « au début de la révélation » : ~25 s de préchargement) ; les chansons 1 et 2 partent au lancement ;
  - retardataire : attente de 3 s maximum, puis il démarre seul dès que son son est prêt, avec ses 15 s (ou 60 s en Progressif) ; la manche dure jusqu'à la fin de son chrono ; ses points sont calculés sur son propre départ ; un joueur arrivé en cours de manche joue à partir de la suivante ;
  - « Je suis prêt » : l'hôte ne peut lancer que lorsque tous les joueurs connectés sont prêts (l'hôte l'est en cliquant « Lancer ») ; un joueur qui recharge la page redevient « pas prêt » ;
  - écran d'intro de 5 s avant la première manche (mode, manches, joueurs, puis 3-2-1) ;
  - si le navigateur bloque le son en pleine partie (rechargement sans clic), un bouton « Activer le son » apparaît ;
  - l'hôte qui se déconnecte ou quitte passe la main au premier joueur connecté ; doublons de pseudo distingués (« Sakura 2 ») ;
  - lien d'invitation `?room=CODE` ; l'adresse de la page devient elle-même le lien à partager ;
  - en fin de partie, chacun revient au salon quand il veut (« Retour au salon ») et l'hôte peut relancer.

## Sons & design

- Effets sonores générés via Web Audio API (cloche, tic-tac, bonne/mauvaise réponse).
- Direction visuelle retenue : **Pastel Sakura** (maquette : https://claude.ai/artifact/HhiGcbNUEN4tR66xJ89jb4).
  - Fond prune `#1B1424`, surfaces `#241B30` / `#2A2035` / `#33284A`
  - Texte `#FFF4FA`, texte secondaire `#CDBCDA`
  - Accent rose `#FF9EC7`, lavande `#B9A6FF`, menthe `#8FF0C8` (succès)
  - Typo : Fredoka (titres), Nunito (texte)
  - Formes très arrondies (pilules, rayons 24–40 px), vinyle animé, barre de progression dégradée lavande → rose, avatars colorés.
