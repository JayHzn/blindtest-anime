/**
 * URL du back. Vide en dev : les appels passent par le proxy Vite.
 * En production (Render) : `VITE_SERVER_URL`, avec « https:// » ajouté si absent.
 */
function resolveServerUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/$/, '');
  if (!value) return '';
  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

export const SERVER_URL: string = resolveServerUrl(import.meta.env.VITE_SERVER_URL);

export const apiUrl = (path: string): string => `${SERVER_URL}${path}`;
