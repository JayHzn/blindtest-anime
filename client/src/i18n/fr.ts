export const fr = {
  'app.name': 'blindtest anime',
  'home.tagline': 'Devine les openings et endings de tes animes préférés.',
  'home.pseudo.label': 'Ton pseudo',
  'home.pseudo.placeholder': 'Ex. Sakura',
  'home.playSolo': 'Jouer en solo',
  'home.createRoom': 'Créer une room',
  'home.soon': 'Bientôt',
  'server.connecting': 'Connexion au serveur…',
  'server.waking': 'Réveil du serveur…',
  'server.ready': 'Prêt',
  'server.unreachable': 'Serveur injoignable',
  'server.retry': 'Réessayer',
  'lang.label': 'Langue',
} as const;

export type MessageKey = keyof typeof fr;
