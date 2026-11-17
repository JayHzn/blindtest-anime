/** URL du back. Vide en dev : les appels passent par le proxy Vite. */
export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL ?? '').replace(/\/$/, '');

export const apiUrl = (path: string): string => `${SERVER_URL}${path}`;
