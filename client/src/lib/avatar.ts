const AVATAR_COLORS = ['#FF9EC7', '#B9A6FF', '#8FF0C8', '#FFD58A', '#9ED8FF', '#FFB8A6'];

/** Couleur d'avatar stable pour un joueur (dérivée de son identifiant). */
export function avatarColor(playerId: string): string {
  let hash = 0;
  for (const char of playerId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}
