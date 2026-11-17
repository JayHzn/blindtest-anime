/** Réponse de `GET /api/health`, utilisée par le front pour réveiller le serveur. */
export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
}
