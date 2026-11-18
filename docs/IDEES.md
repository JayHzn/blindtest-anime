# Blindtest Anime — Pistes d'innovation

Mis à jour le 2026-11-17. Les concepts validés sont acceptés ; leur version (v1.5, v2…) sera fixée plus tard, avant de passer dans DECISIONS.md.

## Ce que fait déjà AMQ (Anime Music Quiz)

Vérifié en ligne :
- Compte obligatoire (email, pays, CGU). Interface EN + traductions communautaires, pas de français.
- 35 000+ chansons, 8 000+ animes. Quiz générés à partir des listes MAL / AniList / Kitsu des joueurs.
- Modes : parties entre amis, solo, Ranked, Battle Royale (5 vies), Last Man Standing, Quickdraw, Team, Boss (power-ups, chaque joueur devient boss à tour de rôle, avec ses propres animes), Nexus (dungeon crawler roguelike). Un « guess mode » a été ajouté en avril 2026, sans détail public.
- Réglages connus : type de chanson, difficulté, années, temps de réponse, point de départ de l'extrait, doublages/rediffusions, nombre de chansons.

Rien trouvé sur : mode à paliers progressifs, écran partagé + téléphones en manettes, enchères, manipulation audio, playlist composée par les joueurs.

Ce qui ne nous différencie PAS : multi temps réel, filtres, révélation vidéo, autocomplétion, scoring à la vitesse, power-ups, liste d'animes des joueurs.

## Concepts validés

Les modes Playlist des joueurs, Enchères, Plus ou moins et Imposteur sont passés dans DECISIONS.md (v2).

### Mode Soirée (style Kahoot)

- **PC** : joue le son (source unique, synchro naturelle) et affiche :
  - le timer et les 4 choix ;
  - la révélation vidéo et le classement entre les manches.
- **Téléphone** : on rejoint par QR code, sans rien installer. L'écran affiche :
  - 4 gros boutons colorés. Réglage de room : titres écrits sur les boutons, ou couleurs seules (vrai style Kahoot, il faut lire l'écran) ;
  - le timer et un retour bon / mauvais.
- **Réponses** : QCM uniquement. Scoring à la vitesse, chronométré par le serveur.
- **Mauvais choix crédibles** : même époque, même genre.
- Sert aussi de base au mode Facile (QCM) de la feuille de route.

### Mode Puzzle (coop)

- **Principe** : chaque joueur entend un fragment différent de la même chanson. L'équipe se parle pour la reconstituer.
- **Vocal** : pas de chat dans le jeu. Le lobby invite à lancer un vocal Discord.
- **Fragments** :
  - points de départ différents, répartis dans le morceau ;
  - durée selon le nombre de joueurs : 2 s à 2 joueurs, 1 s à 6 et plus ;
  - 3 écoutes maximum par fragment ;
  - au bout de 20 s, les fragments s'allongent à 3 s (3 nouvelles écoutes), mais la manche rapporte moins.
- **Réponses** : n'importe qui peut répondre, 2 essais par joueur et par manche.
- **Vies** : 3 vies d'équipe. Une vie est perdue quand la chanson n'est pas trouvée (temps écoulé ou tous les essais utilisés).
- **Deux variantes** :
  - **Aventure** : 5 chapitres de 5 chansons, de plus en plus durs (top 100 → top 500 → top 2000 → tout le catalogue → tout le catalogue avec des fragments plus courts). Écran « Chapitre 2 » entre les chapitres, +1 vie (3 maximum).
    - La dernière chanson du chapitre 5 est la « chanson finale » : fragments plus courts, écran de victoire si l'équipe la trouve.
    - Un chapitre terminé est débloqué : on n'a pas à le refaire, la partie suivante peut commencer au chapitre suivant (avec 3 vies).
    - Progression propre à chaque joueur. L'hôte choisit le chapitre de départ parmi ceux qu'il a débloqués ; chaque joueur qui termine un chapitre le débloque pour lui.
  - **Survie** : sans fin, selon les filtres de la room, aucune vie regagnée. Record : nombre de chansons trouvées d'affilée.
- **Progression et records** : gardés dans la base hébergée (voir « Stockage persistant »).
- Multi uniquement, 2 joueurs minimum.

### Défi du jour

- **Format** : 5 chansons en Progressif (paliers 0,5 / 1 / 5 / 15 s).
- **Difficulté croissante dans la semaine** : top 100 le lundi … tout le catalogue le dimanche.
- **Règles** :
  - les mêmes chansons pour tout le monde, renouvelées à minuit (heure de Paris) ;
  - une seule tentative par jour ;
  - les réponses ne sont visibles qu'après avoir joué.
- **Partage** : grille d'emojis à copier dans Discord, avec le lien du site. 🟩 1er palier, 🟨 2e, 🟧 3e, 🟥 4e, ⬛ ratée.
- **Groupes de potes** : créés via un lien. Ils montrent le score du jour de chaque membre et sa série de jours joués d'affilée.
- Solo (chacun joue de son côté, on se compare ensuite).

### Stockage persistant

- Besoin : classement du Défi du jour, séries, progression de l'Aventure, records de Survie. Render gratuit n'a pas de disque persistant et les rooms sont en mémoire.
- Choix : une petite base hébergée (Turso par exemple, du SQLite comme le catalogue). Offre gratuite à vérifier au moment de le faire.
- Toujours sans compte : le joueur est reconnu par la clé déjà gardée dans son navigateur.
- Seuls ces modes en dépendent ; le reste du site fonctionne sans elle.

### Tournoi en duels

- **Tableau** : élimination directe, 3 à 8 joueurs, tirage au sort. Si le nombre ne tombe pas juste, des joueurs tirés au hasard passent directement au 2e tour.
- **Duel** : premier à 2 points (3 chansons maximum) ; finale au premier à 3. Environ 12 min à 8 joueurs.
- **Buzzer** :
  - le premier qui buzze coupe le son et a 5 s pour répondre (autocomplétion) ;
  - bonne réponse : il marque le point ;
  - mauvaise réponse : il est bloqué pour cette chanson, le son reprend, l'adversaire peut buzzer ;
  - personne ne trouve : chanson suivante, aucun point.
- **Équité** : le serveur départage les buzz en corrigeant le retard réseau de chacun (mesure d'horloge du multi).
- **Spectateurs** :
  - les duels se jouent l'un après l'autre, tout le monde regarde, entend le son et voit les buzz en direct ;
  - ils peuvent taper leur réponse en silence, pour le fun ;
  - avant chaque duel, ils parient sur le gagnant : +50 si c'est juste, dans un classement « meilleur parieur » à part.
- **Petite finale** pour la 3e place : facultative, réglage de l'hôte.
- Multi uniquement.

## Plus tard

- **Mashup** : deux OP superposés, il faut trouver les deux. À faire seulement si le résultat est vraiment clean.
  - Analyse au build (Essentia) : tonalité, BPM, temps forts.
  - Paires compatibles uniquement : roue de Camelot, BPM à ±3 %.
  - Calage sur un temps fort, léger panoramique gauche/droite.
  - Test de faisabilité sur une centaine de chansons avant tout engagement.

## Retenus, règles à définir

- **Quel est le bon OP ? (blindtest à l'envers)** : on voit le titre d'un anime, on écoute 4 courts extraits, il faut retrouver le sien. Les 3 autres sont des chansons proches (même tirage que l'Imposteur : même type, même époque, popularité voisine). Solo et multi ; peut servir de mode Facile.
  - À trancher : durée des extraits, réécoute libre ou limitée, points selon la rapidité ou fixes, un essai ou plusieurs, OP et ED mélangés.
- **Chronologie** : 4 extraits à remettre dans l'ordre de sortie de l'anime, sur une frise. Solo et multi ; les années sont déjà dans le catalogue.
  - À trancher : nombre de chansons (4, 5 ?), points par chanson bien placée ou tout-ou-rien, départage des animes de la même année (saison ?), afficher les titres ou seulement le son.
- **Likes et playlist** : liker les chansons entendues pendant les parties pour se faire sa propre playlist, à exporter vers Spotify ou YouTube Music.
  - À trancher : likes gardés dans le navigateur (sans compte) ou comptes (et alors quelle base de données, Render n'ayant pas de disque permanent en gratuit) ; export par lien, liste à importer (Soundiiz, TuneMyMusic) ou connexion directe à Spotify / YouTube.

## À creuser

- **Extraits trafiqués** : son inversé, basses seules, voix supprimée, version 8-bit simulée (Web Audio).
- **Sabotage entre joueurs** : objets gagnés en trouvant vite.
- **Révélation visuelle progressive** : vidéo de l'OP pixelisée et muette, puis le son arrive.
- **Paris** sur qui va trouver en premier.
- **Récap de soirée partageable** (image de fin).
