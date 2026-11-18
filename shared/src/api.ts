/** Réponse de `GET /api/health`, utilisée par le front pour réveiller le serveur. */
export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
  /** Version du catalogue chargé, ou `null` si aucun catalogue n'est disponible. */
  catalogueVersion: string | null;
  /**
   * Miroir audio (R2) : chansons copiées connues du serveur et raison du dernier échec
   * de lecture de la liste (null : tout va bien). `null` si le miroir n'est pas configuré.
   */
  mirror?: { songs: number; error: string | null } | null;
}

/** Réponse de `GET /api/themes/count?popularity=&types=OP,ED&yearFrom=&yearTo=`. */
export interface ThemeCountResponse {
  count: number;
}
