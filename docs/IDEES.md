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

### Mode Playlist des joueurs (inclut l'ancien « Piège »)

- **Option** : chansons par joueur, de 1 à 10. À 1, c'est le mode Piège.
- **Phase de choix** : 60 s pour 5 chansons par défaut, 90 s si l'hôte monte à 10. Recherche par autocomplétion, aperçu de 5 s. Choix secrets.
- **Tirage** :
  - si le temps est écoulé, les choix manquants sont complétés au hasard selon les filtres ;
  - l'hôte fixe le nombre de manches ;
  - le serveur tire le même nombre de chansons dans le choix de chaque joueur, puis mélange.
- **Doublon** : la chanson est jouée une fois, avec les deux joueurs comme poseurs.
- **Sa propre chanson** : le poseur ne répond pas ; écran « C'est ton piège », il voit en direct qui trouve.
- **Scoring du poseur** :
  - tout le monde trouve : 0 ;
  - personne ne trouve : 0, sans pénalité (perdre les +100 par joueur piégé suffit à décourager les sons introuvables) ;
  - certains trouvent : +100 par joueur piégé.
- **Joueurs qui trouvent** : points normaux + 50 (« piège désamorcé »).
- **Bonus « Devine qui l'a choisie »** : une fois l'anime trouvé, choisir le poseur parmi les pseudos ; +50 si c'est juste.
- **Révélation** : « Choisi par Kevin : 2 joueurs sur 4 ont trouvé ».
- Multi uniquement.

### Mode Enchères

- **Indice affiché avant l'annonce** : Type · Année · Genre (ex. « ED · 2009 · Shōnen »).
- **Annonce secrète et simultanée** (8 s) : 0,5 s · 1 s · 3 s · 5 s · 10 s.
- **Ordre** : l'annonce la plus courte a la main ; en cas d'égalité, le premier à avoir annoncé (horodatage serveur).
- **Écoute** : tout le monde entend l'extrait de la durée annoncée. Seul ce joueur répond, 1 essai, 10 s.
- **Bonne réponse** : points selon l'audace (0,5 s = 300 … 10 s = 50), fin de manche.
- **Mauvaise réponse** :
  - pénalité proportionnelle à l'audace (−150 à 0,5 s … −25 à 10 s) ;
  - la main passe à l'annonce suivante, qui réentend l'extrait à sa durée (plus longue).
- **Pression à l'écran** : pendant la réponse, afficher en gros la pénalité en jeu (« −150 si tu te trompes »).
- Serveur : suite d'états ANNONCE → ÉCOUTE → RÉPONSE → (suivant) → RÉVÉLATION sur le moteur arbitre existant.

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

## Plus tard

- **Mashup** : deux OP superposés, il faut trouver les deux. À faire seulement si le résultat est vraiment clean.
  - Analyse au build (Essentia) : tonalité, BPM, temps forts.
  - Paires compatibles uniquement : roue de Camelot, BPM à ±3 %.
  - Calage sur un temps fort, léger panoramique gauche/droite.
  - Test de faisabilité sur une centaine de chansons avant tout engagement.

## À creuser

- **Extraits trafiqués** : son inversé, basses seules, voix supprimée, version 8-bit simulée (Web Audio).
- **Sabotage entre joueurs** : objets gagnés en trouvant vite.
- **Révélation visuelle progressive** : vidéo de l'OP pixelisée et muette, puis le son arrive.
- **Paris** sur qui va trouver en premier.
- **Récap de soirée partageable** (image de fin).
