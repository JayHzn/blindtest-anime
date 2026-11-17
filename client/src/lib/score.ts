/** Score affiché avec un vrai signe moins (les pénalités des Enchères peuvent le rendre négatif). */
export function formatScore(score: number): string {
  return score < 0 ? `−${-score}` : String(score);
}
