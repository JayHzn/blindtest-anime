/** Réponse de `GET /api/health`, utilisée par le front pour réveiller le serveur. */
export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
  /** Version du catalogue chargé, ou `null` si aucun catalogue n'est disponible. */
  catalogueVersion: string | null;
}

/** Réponse de `GET /api/themes/count?popularity=&types=OP,ED&yearFrom=&yearTo=`. */
export interface ThemeCountResponse {
  count: number;
}
