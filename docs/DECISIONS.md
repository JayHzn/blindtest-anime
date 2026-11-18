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
  - genre (indice du mode Enchères) : public cible AniList (tag « Demographic » : Shōnen, Seinen, Shōjo, Josei, Jeunesse) s'il est pertinent à 60 % ou plus, sinon le genre AniList le plus parlant (Mecha, Sport, Musique… avant Action ou Aventure, qu'AniList liste par ordre alphabétique). Au 2026-11-17 : 4 891 animes sur 4 900 ont un genre. Un ancien catalogue sans la colonne reste lisible (indice sans genre).
  - titres français : Wikidata (propriété P8729 = ID AniList ; P179 = série parente), libellés « saison N de X » reformulés en « X — Saison N »
  - franchise = la plus grande série AnimeThemes de l'anime, sinon l'anime seul ;
  - musique retenue par thème : version originale (pas de groupe doublage), première version non NSFW, vidéo préférée sans scènes d'épisode, sans crédits, en 720p ;
  - aucun appel externe pendant une partie ;
  - autocomplétion **dans le navigateur** : le serveur envoie une fois l'index des titres (`/api/titles`, compressé, ETag), la recherche tourne côté client sans requête réseau par frappe ; le serveur revalide toujours la réponse ;
  - le catalogue contient les métadonnées et les liens, jamais les fichiers audio ;
  - un build qui échoue (ex. API AnimeThemes indisponible) n'écrase jamais le catalogue existant.
- **Audio** :
  - **Développement local (étapes 1 à 5)** : proxy audio opaque (`/api/audio/:token`) vers le CDN AnimeThemes, pour ne pas révéler le nom du fichier.
  - **Miroir audio sur Cloudflare R2** (mis en place le 2026-11-18) : le navigateur lit l'audio des chansons copiées sur R2, via un Worker (`mirror-worker/`, https://anilind-audio.anilind.workers.dev), sans passer par notre serveur — la bande passante sortante de Render gratuit est limitée (quelques Go par mois).
    - Fichiers nommés `a/<empreinte>.ogg`, empreinte = HMAC-SHA256(`MIRROR_SECRET`, n° de la chanson) : sans la clé (connue du serveur et du script d'envoi seulement), le nom ne dit rien de la chanson. `index.json` liste les numéros des chansons copiées ; le serveur le relit au démarrage puis toutes les 6 h.
    - Le Worker ne sert que ces deux sortes de fichiers, gère les requêtes par plage (indispensables pour se placer dans le morceau) et met les fichiers en cache permanent. Offre gratuite : 10 Go stockés, sortie gratuite, 100 000 requêtes par jour.
    - Réencodage en Opus 96 kbit/s (environ 1,1 Mo par chanson). Top 2000 = 6 159 chansons, environ 7 Go : tient dans les 10 Go gratuits, pas le catalogue entier (13 855).
    - Script `npm run mirror:sync -w server -- --top 500|2000|all [--max N]` : télécharge depuis AnimeThemes une chanson à la fois (pause de 0,4 s), réencode (ffmpeg), envoie, met `index.json` à jour toutes les 20 chansons ; reprend là où il s'est arrêté. Accès dans `server/.env.r2` (jamais commité) ; `MIRROR_URL` et `MIRROR_SECRET` dans les variables d'environnement de Render.
    - Chanson pas encore copiée, ou fichier du miroir qui ne se charge pas : l'audio passe par le proxy du serveur, comme avant.
    - Réhébergement acceptable pour un usage entre potes, à revoir si le site devient public.
  - Volume déjà normalisé par AnimeThemes (−16 LUFS, vérifié sur 14 fichiers) : aucune normalisation à faire.
  - **Chargement côté client** :
    - préchargement des **2 chansons suivantes** ;
    - le son est **décodé à l'avance** (Web Audio, `AudioBuffer`), pour un démarrage instantané et précis ;
    - connexion ouverte vers le serveur des sons dès l'arrivée sur le site (`preconnect`) ;
    - fichiers à noms aléatoires servis avec un **cache permanent** (`Cache-Control: immutable`) ;
    - **départ commun programmé** (2026-11-18) : le serveur fixe l'heure de départ de l'écoute 0,5 s dans le futur (`LISTEN_LEAD_MS`) ; chaque navigateur prolonge le « 3-2-1 » jusqu'à cette heure, puis lance chrono et extrait ensemble, depuis la position préchargée. Mesuré avec 200 ms de délai réseau simulé : son et chrono démarrent à 0-2 ms près (avant : 0,7 s de silence en local, 1 à 2 s en ligne, parce que le lecteur se repositionnait pour rattraper le retard réseau et rechargeait le son) ;
    - filet de sécurité : un retard de moins d'1 s ne fait jamais repositionner un extrait (le son chargé est gardé) ; au-delà (reconnexion en pleine écoute), on rattrape l'extrait là où il en est.
  - **Découpage en morceaux de 5 s** (miroir R2, à confirmer par un test) :
    - chaque chanson est encodée une seule fois, puis découpée en morceaux de 5 s ;
    - le client ne charge que les morceaux couvrant l'extrait (environ 200 Ko au lieu d'environ 1 Mo), puis les recolle avant de jouer ;
    - à vérifier : aucun clic ni blanc audible aux jonctions. En cas d'échec : chanson entière (environ 1 Mo).
  - Si le préchargement échoue, le client prévient le serveur, qui tire une autre chanson avant le début de la manche. Si toutes les sources sont indisponibles : message « Musiques indisponibles, réessaie plus tard ».
- **Vidéo de révélation** (revu le 2026-11-18) : chargée par le navigateur **directement chez AnimeThemes**, sans passer par notre serveur — la bande passante sortante de Render gratuit est limitée (quelques Go par mois, à confirmer sur la page de facturation), et la vidéo en représentait environ 80 % (10 à 40 Mo par manche et par joueur). Le lien direct (qui contient le nom de l'anime) n'est envoyé qu'à un joueur qui ne peut plus répondre : avec la révélation pour tout le monde, et plus tôt (`round:video`) à celui qui a trouvé, est éliminé, a abandonné ou a choisi la chanson (Playlist), qui la précharge pendant que les autres cherchent. Mesuré : environ 3 à 5 s de chargement quand elle part à la révélation ; d'ici là, **jaquette AniList** (fond flouté à sa couleur dominante) et l'extrait continue. 2 nouvelles tentatives si le CDN refuse (il limite les requêtes rapprochées). Plus ou moins et Imposteur : jaquettes seulement. Jaquette disponible pour 4 894 animes sur 4 900.
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
- Choisir une suggestion (clic ou Entrée) l'inscrit dans le champ et passe la main au numéro d'OP/ED ; on valide ensuite (Entrée ou « Valider »). Validée tout de suite si le numéro est déjà tapé, si l'anime n'a qu'un opening et qu'un ending (indicateur `u` de l'index des titres ; le champ du numéro est alors masqué), ou sans bonus (Enchères, Imposteur).
- Anime à un seul opening et un seul ending : jamais de bonus de numéro (le numéro est évident), même tapé à la main (décidé le 2026-11-18).

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
  - le lien de la vidéo (qui contient le nom de l'anime) n'est envoyé qu'aux joueurs qui ne peuvent plus répondre : voir « Vidéo de révélation ».

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

### Enchères (v2, multi uniquement)

Validé le 2026-11-17 (maquette : https://claude.ai/artifact/XcACCcnxgKHnBmUUtSfJ5u).

- **Principe** : chacun annonce en secret la durée d'extrait qu'il lui faut ; l'annonce la plus courte a la main et répond seule.
- **2 joueurs minimum** au lancement. 10 manches par défaut, réglable comme ailleurs.
- **Indice** affiché avant l'annonce : Type · Année · Genre (ex. « ED · 2009 · Shōnen »), voir « Catalogue » pour le genre.
- **Annonce** secrète et simultanée, 8 s : 0,5 / 1 / 3 / 5 / 10 s.
  - on voit qui a annoncé, jamais la durée ; l'annonce se termine dès que tout le monde a annoncé ;
  - on peut changer d'avis pendant les 8 s : l'horodatage est celui de la dernière annonce (pas d'annonce prudente rapide changée au dernier moment) ;
  - pas d'annonce : le joueur ne joue pas la manche (0 point, pas de pénalité) ; personne n'annonce : révélation directe.
- **Ordre de passage** : l'annonce la plus courte d'abord ; à égalité, celui qui a annoncé le premier (horodatage serveur). Affiché 1,5 s avant le premier extrait.
- **Écoute** : tout le monde entend l'extrait de la durée annoncée par celui qui a la main.
- **Réponse** : lui seul répond, **1 essai, 10 s** après la fin de l'extrait ; il peut **réécouter 3 fois au maximum** (lui seul entend ces réécoutes, le chrono continue).
- **Barème** :
  - bonne réponse : **300 / 250 / 200 / 100 / 50** selon l'annonce, et fin de manche ;
  - mauvaise réponse : **−150 / −100 / −75 / −50 / −25** ; la main passe à l'annonce suivante, et l'extrait est rejoué à sa durée (2 s de pause pour voir l'erreur) ;
  - silence pendant les 10 s : compte comme une erreur (même pénalité) ;
  - pas de bonus de précision (un seul champ : l'anime) ;
  - les scores peuvent devenir négatifs.
- **Tout le monde s'est trompé** : révélation directe, chacun garde sa pénalité.
- **Pression à l'écran** : pendant la réponse, la pénalité en jeu s'affiche en gros chez tous (« −150 si tu te trompes » / « −150 si Kevin se trompe »).
- **Mauvaise réponse montrée à tous** (proposition barrée et pénalité) : ce n'est jamais la bonne réponse, rien n'est révélé.
- **Départs** : celui qui a la main se déconnecte, la main passe sans pénalité ; un joueur absent à son tour est sauté ; un joueur arrivé en cours de manche regarde et joue à la suivante.
- Détails (mise en œuvre) :
  - états serveur : ANNONCE (`bidding`) → ÉCOUTE (`listening`) → RÉPONSE (`answering`) → (joueur suivant) → RÉVÉLATION ; tout est arbitré par le serveur (annonces, ordre, chrono, points), dans `AuctionRound`, branché sur le moteur commun ;
  - chaque joueur reçoit sa vue de la manche (`auction:state`) à chaque changement, et dans `game:state` à la reconnexion : les annonces des autres restent secrètes jusqu'à la fin de l'annonce, rien ne révèle la réponse avant la révélation ;
  - même mécanisme que le Progressif : le navigateur coupe l'extrait à la bonne durée (vérifié : 0,5 s et 1 s jouées à ~5 ms près) ;
  - chaque extrait part à une **heure de départ commune** fixée par le serveur (0,5 s d'avance au moins), avec la correction d'horloge du multi (vérifié : 0 à 12 ms d'écart entre deux navigateurs) ; un extrait bloqué (son pas chargé) s'arrête au plus tard 2 s après sa durée ;
  - préchargement inchangé : la chanson suivante part au début de l'annonce ; l'extrait attend le son de celui qui a la main 3 s au maximum, puis part quand même ;
  - la vidéo de révélation se précharge dès l'annonce et reprend là où le dernier extrait s'est arrêté.

### Plus ou moins (v2, solo et multi)

Validé le 2026-11-17 (maquette : https://claude.ai/artifact/XB4rhpAbMMXY5yeoM9RTKt), mis en œuvre le 2026-11-18.

- **Principe** : la nouvelle chanson vient-elle d'un anime plus ou moins populaire que la référence ? Popularité = nombre de membres AniList de l'anime. Pas de réponse tapée : deux boutons.
- **Extrait** : 10 s, point de départ tiré entre 0 et 60 % du morceau (comme le Classique).
- **Tour 1** : A (10 s), puis B (10 s), puis 10 s pour choisir ; le choix s'ouvre dès que B commence. Boutons « A est plus populaire » / « B est plus populaire ».
- **Tours suivants** : la référence (chanson du tour précédent) est affichée en clair : jaquette, titre, OP/ED, chanson, artiste, année, membres. Seule la nouvelle chanson est jouée (10 s), puis 10 s pour choisir ; le choix est possible dès le début de l'extrait.
- **Réécoute** libre des deux chansons pendant le tour (côté navigateur, rien n'est compté).
- **Choix définitif**. Pas de réponse à temps = erreur.
- **Écart de popularité** (rapport entre les deux nombres de membres) : ≥ ×1,5 (tours 1 à 3), ×1,3 à ×3 (4 à 6), ×1,2 à ×2 (7 à 9), ×1,1 à ×1,5 (10 et plus). Jamais d'égalité (écart minimal ×1,1).
- **Révélation** : 6 s, jaquettes (pas de vidéo), membres, écart, choix de chacun, puis décompte de 3 s.
- **Élimination** : une erreur élimine. En solo (ou seul en room), elle termine la partie.
- **Pas de réglage de manches** (masqué) : 30 tours au plus, puis les joueurs encore en jeu finissent ex æquo. Les filtres de la room (popularité, type, années) s'appliquent au tirage.
- **Multi** (choix par défaut de la maquette, acceptés tels quels) :
  - on voit qui a répondu (coche « a répondu »), jamais quoi, avant la révélation ;
  - tous faux au même tour : personne n'est éliminé ;
  - les éliminés restent en spectateurs (son, révélations) sans répondre ; un joueur arrivé en cours de partie regarde aussi ;
  - la partie s'arrête quand il ne reste qu'un joueur en jeu (il gagne) ;
  - classement : selon le tour d'élimination (le plus tardif d'abord), puis le nombre de bonnes réponses.
- **Record solo** : la plus longue série, par réglages (popularité, type, années), gardée dans le navigateur.
- **Écran de fin** : en solo, longueur de la série, record, l'erreur qui l'a arrêtée (les deux animes, l'écart, le choix fait) et toute la chaîne ; en multi, gagnant, classement (« Élimination au tour N · X justes sur Y tours »), tours où tout le monde s'est trompé et écart le plus serré.
- Détails (mise en œuvre) :
  - la chaîne entière (31 chansons) est **tirée au lancement** : jamais deux fois la même franchise, animes sans popularité AniList exclus ; chaque chanson respecte l'écart de son tour avec la précédente, sinon (catalogue trop petit avec les filtres) celle qui s'en rapproche le plus ; une chaîne trop courte termine la partie plus tôt ;
  - la manche N du moteur est le tour N ; la chanson 0 (A) ne sert que de première référence. Au lancement, les chansons 0, 1 et 2 sont préchargées ; pendant le tour N, la chanson N+1 ;
  - le tour 1 attend que A et B soient prêts chez chacun (mêmes règles d'attente que les autres modes) ; chaque joueur a son propre chrono (30 s au tour 1, 20 s ensuite) ;
  - le navigateur joue A puis B (ou la nouvelle chanson) à l'heure fixée par le serveur et garde la référence en mémoire pour la réécoute ;
  - le serveur arbitre le choix (`higherLower:pick`) : refusé avant le début de B (300 ms de tolérance) ou après la fin du temps ; la révélation arrive dès que tous les joueurs encore en jeu ont choisi ;
  - le score d'un joueur compte ses bonnes réponses ; `eliminatedAt` (tour d'élimination, 0 pour un spectateur arrivé en cours de partie) sert au classement ;
  - un audio injouable (pas encore joué) est remplacé en retirant la suite de la chaîne à partir de lui, pour que chaque écart reste respecté.

### Imposteur (v2, multi uniquement, style Undercover)

Validé le 2026-11-18 (maquette : https://claude.ai/artifact/DHKrGNmaYzFKQJXyiMA3Uz), mis en œuvre le même jour.

- **Principe** : à chaque manche, la majorité (les civils) a la chanson X, 1 ou 2 imposteurs une chanson Y proche. **Personne ne connaît son rôle** : l'imposteur découvre peu à peu que ses indices ne collent pas avec ceux des autres.
- **Joueurs** : 4 minimum ; 1 imposteur de 4 à 5 joueurs, 2 à partir de 6. Rôles tirés au hasard à chaque manche.
- **Chanson de l'imposteur** : même type (OP/ED), années à 5 ans près, popularité à ×2,5 près, même genre AniList si possible (à défaut : la plus proche en popularité, du même type). Jamais deux fois la même franchise dans une partie.
- **Titre affiché** : chacun voit le titre de **sa** chanson (jaquette, anime, OP/ED, chanson, artiste) dès l'écoute et pendant toute la manche, pour pouvoir en parler même sans la connaître. L'imposteur voit le sien.
- **Écoute** : extrait de 15 s (point de départ tiré entre 0 et 60 %), puis **réécoute libre** de sa propre chanson.
- **Indices** : chacun à son tour (ordre tiré au hasard à chaque tour) tape **un seul mot**, en 20 s, visible par tous. Refusés : un mot du titre de l'anime ou de sa série (mots de 3 lettres et plus, accents et casse ignorés ; « naruto-kun » aussi), ou un mot déjà donné dans la manche. Pas de mot à temps (ou joueur déconnecté) : « … » et on passe.
- **Vote** (durée choisie par l'hôte : 15 / 20 / 30 / 45 s, 30 par défaut) : on vote pour éliminer un joueur encore en jeu ; on peut changer d'avis ; fin anticipée quand tout le monde a voté. On voit qui a voté, jamais contre qui ; après le vote, seul le total par joueur s'affiche.
  - Le plus voté est éliminé et **son rôle est révélé** (civil ou imposteur), pas sa chanson.
  - Égalité : revote de 15 s entre les ex æquo, qui ne votent pas. Nouvelle égalité (ou aucun vote) : personne n'est éliminé, on repart pour un tour d'indices.
- **Fin de manche** (élimination comme Undercover) :
  - **les civils gagnent** quand tous les imposteurs sont éliminés ; chaque civil encore en jeu a alors 15 s et **un essai** pour deviner la chanson de l'imposteur (l'anime suffit, comme ailleurs) ;
  - **les imposteurs gagnent** dès qu'ils sont aussi nombreux que les civils encore en jeu, ou après 6 tours d'indices (garde-fou contre les égalités à répétition).
- **Barème** : civils gagnants +100 chacun (éliminés compris), +100 pour la chanson de l'imposteur devinée ; imposteurs gagnants +300 chacun.
- **Éliminés** : ils suivent la manche en spectateurs (indices, votes, éliminations), sans donner de mot ni voter ; un joueur arrivé en cours de manche regarde et joue à la suivante.
- **Réglages de l'hôte** : dans le salon existant, le mode et la ligne « Durée du vote » ; le nombre de manches reste le réglage existant.
- **Révélation de fin de manche** (14 s) : verdict, les deux chansons (réécoutables), rôle, mots et points de chacun, classement à côté.
- **Fin de partie** : classement aux points, nombre de fois imposteur (et manches gagnées), chansons devinées, meilleur imposteur, manches gagnées par camp.
- Détails (mise en œuvre) :
  - au lancement, les paires de chansons sont tirées pour toutes les manches (plus 5 de rechange) ;
  - les rôles d'une manche sont tirés quand son audio est envoyé (préchargement) : chaque joueur reçoit l'audio opaque de **sa** chanson, si bien que rien ne permet de comparer avec les autres ; si l'imposteur quitte la partie avant sa manche, un autre joueur est désigné ;
  - états serveur : ÉCOUTE → INDICES (joueur par joueur) → VOTE (→ REVOTE) → ÉLIMINATION (6 s) → tour suivant, ou DEVINETTE → RÉVÉLATION ; tout est arbitré par `ImpostorRound`, branché sur le moteur commun ;
  - chaque joueur reçoit sa vue de la manche (`impostor:state`, et dans `game:state` à la reconnexion) : jamais le rôle des autres avant leur élimination, ni l'autre chanson avant la révélation ; les deux audios ne sont envoyés qu'à la révélation, pour la réécoute ;
  - l'extrait du début de manche part à une heure commune fixée par le serveur (0,8 s d'avance).

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
