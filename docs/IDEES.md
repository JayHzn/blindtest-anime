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
