/**
 * Mise en forme des titres français issus de Wikidata, souvent au format
 * « saison 3 de L'Attaque des Titans » ou « SPY×FAMILY saison 1 ».
 */

/** « saison 3 de X », « 2e saison de X » */
const SEASON_OF =
  /^(?:saison (\d+)|(\d+)(?:re|ère|e|ème) saison) de (?:la série |la série télévisée )?(.+)$/i;
/** « X saison 1 », « X (saison 2) », « X, saison 3 » */
const SEASON_SUFFIX = /^(.+?)[\s,]*\(?saison (\d+)\)?$/i;

export interface ParsedFrenchLabel {
  /** Titre à afficher, ex. « L'Attaque des Titans — Saison 3 ». */
  display: string;
  /** Titre de la franchise si le libellé désigne une saison, ex. « L'Attaque des Titans ». */
  base: string | null;
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const season = (base: string, number: string): ParsedFrenchLabel => {
  const title = capitalize(base.trim());
  return { display: `${title} — Saison ${number}`, base: title };
};

export function parseFrenchLabel(label: string): ParsedFrenchLabel {
  const trimmed = label.trim();
  const prefix = SEASON_OF.exec(trimmed);
  if (prefix) return season(prefix[3]!, (prefix[1] ?? prefix[2])!);
  const suffix = SEASON_SUFFIX.exec(trimmed);
  if (suffix) return season(suffix[1]!, suffix[2]!);
  return { display: capitalize(trimmed), base: null };
}
