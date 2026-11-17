/**
 * Normalisation de texte pour comparer des titres d'anime :
 * casse, accents, ponctuation et macrons (ō, ū) ignorés.
 */

const DIACRITICS = /[̀-ͯ]/g;
const NON_ALNUM = /[^a-z0-9]+/g;

/** « Shingeki no Kyojin: Season 3! » → « shingeki no kyojin season 3 » */
export function normalize(input: string): string {
  return input
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/×/g, 'x')
    .replace(NON_ALNUM, ' ')
    .trim();
}

/** Forme compacte sans espaces : « shingeki no kyojin » → « shingekinokyojin » */
export function compact(normalized: string): string {
  return normalized.replace(/ /g, '');
}

/**
 * Distance de Damerau-Levenshtein (variante OSA) : insertions, suppressions,
 * substitutions et inversions de deux lettres voisines.
 * S'arrête dès que la distance dépasse `max` (renvoie alors `max + 1`).
 */
export function editDistance(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevPrev: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j]! + 1, current[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2]! + 1);
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = current;
  }
  return prev[b.length]!;
}

/**
 * Version rapide (sans allocation) de `editDistance(a, b) <= 1`,
 * utilisée à chaque frappe par l'autocomplétion.
 */
export function withinOneEdit(a: string, b: string): boolean {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  if (i === la && i === lb) return true;
  if (la === lb) {
    // substitution, ou inversion de deux lettres voisines
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  // insertion / suppression
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** Nombre de fautes tolérées selon la longueur (forme compacte). */
export function allowedTypos(length: number): number {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  if (length <= 16) return 2;
  return 3;
}

/**
 * Le texte saisi correspond-il au titre, à quelques fautes près ?
 * Les deux arguments sont des formes compactes.
 * Renvoie la distance si ça correspond, sinon `null`.
 */
export function fuzzyMatch(answerCompact: string, titleCompact: string): number | null {
  if (!answerCompact || !titleCompact) return null;
  const max = allowedTypos(titleCompact.length);
  const distance = editDistance(answerCompact, titleCompact, max);
  return distance <= max ? distance : null;
}
