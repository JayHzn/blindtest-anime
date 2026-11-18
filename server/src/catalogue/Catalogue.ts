import Database from 'better-sqlite3';
import {
  HIGHER_LOWER,
  compact,
  fuzzyMatch,
  inRatioWindow,
  normalize,
  popularityRatio,
  ratioWindow,
  type AnswerPayload,
  type AnswerVerdict,
  type CatalogueStats,
  type ThemeFilters,
  type TitleEntry,
  type TitleIndex,
} from '@blindtest/shared';
import { readCatalogue } from './store';
import type { AnimeRow, CatalogueData, FranchiseRow, ThemeRow } from './types';

export type Lang = 'fr' | 'en';

interface AnimeRecord extends AnimeRow {
  /** Titres acceptés, normalisés. */
  normalizedTitles: string[];
}

interface FranchiseRecord extends FranchiseRow {
  animeIds: number[];
  normalizedTitles: string[];
  popularity: number;
}

const MAX_ANSWER_LENGTH = 200;

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/**
 * Catalogue chargé en mémoire au démarrage du serveur.
 * Toutes les requêtes de jeu (tirage, validation, autocomplétion) se font ici,
 * sans aller-retour vers la base ni vers une API externe.
 */
export class Catalogue {
  readonly version: string;
  readonly generatedAt: string;
  readonly titleIndex: TitleIndex;
  private readonly anime = new Map<number, AnimeRecord>();
  private readonly franchises = new Map<number, FranchiseRecord>();
  private readonly themes = new Map<number, ThemeRow>();
  private readonly themeList: ThemeRow[];
  private readonly themesByAnime = new Map<number, ThemeRow[]>();

  static load(path: string): Catalogue {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      return new Catalogue(readCatalogue(db));
    } finally {
      db.close();
    }
  }

  constructor(data: CatalogueData) {
    this.generatedAt = data.generatedAt;
    this.version = data.generatedAt.replace(/\D/g, '').slice(0, 14) || 'dev';

    const titlesByOwner = new Map<string, string[]>();
    for (const row of data.titles) {
      const key = `${row.ownerKind}:${row.ownerId}`;
      const normalized = normalize(row.title);
      if (!normalized) continue;
      const list = titlesByOwner.get(key) ?? [];
      list.push(normalized);
      titlesByOwner.set(key, list);
    }

    for (const row of data.franchises) {
      this.franchises.set(row.id, {
        ...row,
        animeIds: [],
        normalizedTitles: unique(titlesByOwner.get(`franchise:${row.id}`) ?? []),
        popularity: 0,
      });
    }
    for (const row of data.anime) {
      const franchise = this.franchises.get(row.franchiseId);
      if (!franchise) continue;
      franchise.animeIds.push(row.id);
      franchise.popularity = Math.max(franchise.popularity, row.popularity);
      this.anime.set(row.id, {
        ...row,
        normalizedTitles: unique(titlesByOwner.get(`anime:${row.id}`) ?? []),
      });
    }
    this.themeList = data.themes.filter((theme) => this.anime.has(theme.animeId));
    for (const theme of this.themeList) {
      this.themes.set(theme.id, theme);
      const list = this.themesByAnime.get(theme.animeId) ?? [];
      list.push(theme);
      this.themesByAnime.set(theme.animeId, list);
    }

    this.titleIndex = { version: this.version, entries: this.buildTitleEntries() };
  }

  getTheme(id: number): ThemeRow | undefined {
    return this.themes.get(id);
  }

  getAnime(id: number): AnimeRow | undefined {
    return this.anime.get(id);
  }

  getFranchise(id: number): FranchiseRow | undefined {
    return this.franchises.get(id);
  }

  stats(): CatalogueStats {
    return {
      version: this.version,
      generatedAt: this.generatedAt,
      anime: this.anime.size,
      franchises: this.franchises.size,
      themes: this.themes.size,
    };
  }

  /** Titre affiché selon la langue : FR → EN → romaji, ou EN → romaji. */
  animeTitle(anime: AnimeRow, lang: Lang): string {
    const romaji = anime.titleRomaji ?? anime.name;
    return lang === 'fr' ? (anime.titleFr ?? anime.titleEn ?? romaji) : (anime.titleEn ?? romaji);
  }

  franchiseTitle(franchise: FranchiseRow, lang: Lang): string {
    return lang === 'fr' ? (franchise.nameFr ?? franchise.name) : franchise.name;
  }

  /** Nombre de musiques disponibles avec ces filtres. */
  countThemes(filters: ThemeFilters): number {
    return this.themeList.filter(this.themeFilter(filters)).length;
  }

  /** Musiques d'un anime (types donnés), triées OP puis ED puis insert, par numéro. */
  themesOfAnime(animeId: number, types: readonly ThemeRow['type'][]): ThemeRow[] {
    const order = { OP: 0, ED: 1, IN: 2 } as const;
    return (this.themesByAnime.get(animeId) ?? [])
      .filter((theme) => types.includes(theme.type))
      .sort((a, b) => order[a.type] - order[b.type] || a.sequence - b.sequence);
  }

  /** Franchise d'une musique (pour éviter de compléter une playlist avec la même série). */
  franchiseOfTheme(themeId: number): number | undefined {
    const theme = this.themes.get(themeId);
    return theme ? this.anime.get(theme.animeId)?.franchiseId : undefined;
  }

  /**
   * Tire `count` musiques au hasard parmi celles qui respectent les filtres,
   * jamais deux fois la même franchise dans une partie (ni une franchise exclue).
   */
  pickThemes(
    filters: ThemeFilters,
    count: number,
    random: () => number = Math.random,
    excludeFranchises: ReadonlySet<number> = new Set(),
  ): ThemeRow[] {
    if (count <= 0) return [];
    const candidates = this.themeList.filter(this.themeFilter(filters));
    // Mélange de Fisher-Yates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }
    const picked: ThemeRow[] = [];
    const usedFranchises = new Set<number>(excludeFranchises);
    for (const theme of candidates) {
      const franchiseId = this.anime.get(theme.animeId)!.franchiseId;
      if (usedFranchises.has(franchiseId)) continue;
      usedFranchises.add(franchiseId);
      picked.push(theme);
      if (picked.length === count) break;
    }
    return picked;
  }

  /**
   * Plus ou moins : enchaîne `length` musiques (filtres de la partie, jamais deux fois
   * la même franchise, animes sans popularité AniList exclus). La musique N (tour N)
   * respecte l'écart du tour avec la précédente ; à défaut, la plus proche de cet écart.
   * `prefix` : début de chaîne gardé (remplacement d'un audio injouable).
   * Renvoie une chaîne plus courte si le catalogue est épuisé.
   */
  higherLowerChain(
    filters: ThemeFilters,
    length: number,
    random: () => number = Math.random,
    prefix: readonly ThemeRow[] = [],
    excludeFranchises: ReadonlySet<number> = new Set(),
  ): ThemeRow[] {
    const filter = this.themeFilter(filters);
    const candidates = this.themeList.filter(
      (theme) => filter(theme) && this.anime.get(theme.animeId)!.popularity > 0,
    );
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }
    const chain = [...prefix];
    const used = new Set(excludeFranchises);
    for (const theme of chain) used.add(this.anime.get(theme.animeId)!.franchiseId);

    while (chain.length < length) {
      const previous = chain[chain.length - 1];
      const window = ratioWindow(chain.length);
      const reference = previous ? this.anime.get(previous.animeId)!.popularity : 0;
      let pick: ThemeRow | undefined;
      let fallback: ThemeRow | undefined;
      let fallbackDistance = Number.POSITIVE_INFINITY;
      for (const theme of candidates) {
        const anime = this.anime.get(theme.animeId)!;
        if (used.has(anime.franchiseId)) continue;
        if (!previous) {
          pick = theme;
          break;
        }
        const ratio = popularityRatio(reference, anime.popularity);
        if (ratio < HIGHER_LOWER.minRatio) continue;
        if (inRatioWindow(ratio, window)) {
          pick = theme;
          break;
        }
        // Écart hors fenêtre : distance (en rapport) à la fenêtre, pour le repli.
        const distance = ratio < window.min ? window.min / ratio : ratio / (window.max ?? ratio);
        if (distance < fallbackDistance) {
          fallback = theme;
          fallbackDistance = distance;
        }
      }
      const next = pick ?? fallback;
      if (!next) break;
      chain.push(next);
      used.add(this.anime.get(next.animeId)!.franchiseId);
    }
    return chain;
  }

  /**
   * Imposteur : `count` paires [chanson des civils, chanson de l'imposteur] proches
   * (même type, années à 5 ans près, popularité à ×2,5 près, même genre si possible),
   * jamais deux fois la même franchise dans la partie. À défaut de chanson proche, la
   * plus proche en popularité, du même type.
   */
  impostorPairs(
    filters: ThemeFilters,
    count: number,
    random: () => number = Math.random,
  ): [ThemeRow, ThemeRow][] {
    const filter = this.themeFilter(filters);
    const candidates = this.themeList.filter(
      (theme) => filter(theme) && this.anime.get(theme.animeId)!.popularity > 0,
    );
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }
    const franchiseOf = (theme: ThemeRow) => this.anime.get(theme.animeId)!.franchiseId;
    const used = new Set<number>();
    const pairs: [ThemeRow, ThemeRow][] = [];

    for (const civil of candidates) {
      if (pairs.length >= count) break;
      if (used.has(franchiseOf(civil))) continue;
      const a = this.anime.get(civil.animeId)!;
      const close: { theme: ThemeRow; score: number }[] = [];
      let fallback: ThemeRow | undefined;
      let fallbackRatio = Number.POSITIVE_INFINITY;
      for (const other of candidates) {
        const franchise = franchiseOf(other);
        if (other.type !== civil.type || franchise === franchiseOf(civil) || used.has(franchise)) {
          continue;
        }
        const b = this.anime.get(other.animeId)!;
        const ratio = Math.max(a.popularity, b.popularity) / Math.min(a.popularity, b.popularity);
        if (ratio < fallbackRatio) {
          fallback = other;
          fallbackRatio = ratio;
        }
        const yearGap = a.year !== null && b.year !== null ? Math.abs(a.year - b.year) : 99;
        if (yearGap > 5 || ratio > 2.5) continue;
        const sameGenre = a.genre !== null && a.genre === b.genre;
        close.push({ theme: other, score: (sameGenre ? 0 : 10) + yearGap + (ratio - 1) * 3 });
      }
      close.sort((x, y) => x.score - y.score);
      // Un peu de hasard parmi les plus proches, pour ne pas toujours tirer le même duo.
      const best = close.slice(0, 5);
      const partner = best.length > 0 ? best[Math.floor(random() * best.length)]!.theme : fallback;
      if (!partner) continue;
      used.add(franchiseOf(civil));
      used.add(franchiseOf(partner));
      pairs.push([civil, partner]);
    }
    return pairs;
  }

  /** Valide la réponse d'un joueur pour une musique donnée. */
  validate(themeId: number, answer: AnswerPayload): AnswerVerdict {
    const wrong: AnswerVerdict = { correct: false, seasonExact: false, sequenceExact: false };
    const theme = this.themes.get(themeId);
    const target = theme ? this.anime.get(theme.animeId) : undefined;
    const franchise = target ? this.franchises.get(target.franchiseId) : undefined;
    if (!theme || !target || !franchise) return wrong;

    const multiSeason = franchise.animeIds.length > 1;
    let correct: boolean;
    let seasonExact = false;

    if (answer.pick) {
      if (answer.pick.kind === 'anime') {
        const picked = this.anime.get(answer.pick.id);
        correct = picked?.franchiseId === franchise.id;
        seasonExact = correct && multiSeason && picked?.id === target.id;
      } else {
        correct = answer.pick.id === franchise.id;
      }
    } else {
      const typed = compact(normalize(answer.text.slice(0, MAX_ANSWER_LENGTH)));
      if (typed.length < 2) return wrong;

      const bestDistance = (titles: string[]): number | null => {
        let best: number | null = null;
        for (const title of titles) {
          const distance = fuzzyMatch(typed, compact(title));
          if (distance !== null && (best === null || distance < best)) best = distance;
        }
        return best;
      };

      const franchiseDistance = bestDistance(franchise.normalizedTitles);
      const animeDistances = franchise.animeIds.map((id) => ({
        id,
        distance: bestDistance(this.anime.get(id)!.normalizedTitles),
      }));
      const all = [franchiseDistance, ...animeDistances.map((a) => a.distance)].filter(
        (d): d is number => d !== null,
      );
      correct = all.length > 0;

      if (correct && multiSeason) {
        const min = Math.min(...all);
        const atMin = animeDistances.filter((a) => a.distance === min);
        // Saison exacte seulement si le texte désigne sans ambiguïté la bonne saison.
        seasonExact = atMin.length === 1 && atMin[0]!.id === target.id;
      }
    }

    // Un seul opening et un seul ending : le numéro n'apporte rien, pas de bonus.
    const sequenceExact =
      correct && answer.sequence === theme.sequence && !this.singleThemeAnime(target.id);
    return { correct, seasonExact, sequenceExact };
  }

  /** L'anime n'a qu'un opening et qu'un ending (le numéro d'OP/ED est évident). */
  private singleThemeAnime(animeId: number): boolean {
    const themes = this.themesByAnime.get(animeId) ?? [];
    return (
      themes.filter((theme) => theme.type === 'OP').length <= 1 &&
      themes.filter((theme) => theme.type === 'ED').length <= 1
    );
  }

  private themeFilter(filters: ThemeFilters): (theme: ThemeRow) => boolean {
    const maxRank = filters.popularity === 'all' ? Number.POSITIVE_INFINITY : filters.popularity;
    const types = new Set(filters.types);
    const hasYearFilter = filters.yearFrom !== undefined || filters.yearTo !== undefined;
    const yearFrom = filters.yearFrom ?? Number.NEGATIVE_INFINITY;
    const yearTo = filters.yearTo ?? Number.POSITIVE_INFINITY;
    return (theme) => {
      if (!types.has(theme.type)) return false;
      const anime = this.anime.get(theme.animeId)!;
      if (anime.popularityRank > maxRank) return false;
      if (hasYearFilter && (anime.year === null || anime.year < yearFrom || anime.year > yearTo)) {
        return false;
      }
      return true;
    };
  }

  private buildTitleEntries(): TitleEntry[] {
    const entries: TitleEntry[] = [];
    for (const franchise of this.franchises.values()) {
      if (franchise.animeIds.length < 2) continue;
      entries.push({
        k: 'f',
        id: franchise.id,
        f: franchise.id,
        fr: this.franchiseTitle(franchise, 'fr'),
        en: this.franchiseTitle(franchise, 'en'),
        t: franchise.normalizedTitles,
        p: franchise.popularity,
      });
    }
    for (const anime of this.anime.values()) {
      const franchise = this.franchises.get(anime.franchiseId)!;
      const multi = franchise.animeIds.length > 1;
      const entry: TitleEntry = {
        k: 'a',
        id: anime.id,
        f: franchise.id,
        fr: this.animeTitle(anime, 'fr'),
        en: this.animeTitle(anime, 'en'),
        // Pour un anime seul dans sa franchise, le nom de la série est aussi accepté.
        t: multi
          ? anime.normalizedTitles
          : unique([...anime.normalizedTitles, ...franchise.normalizedTitles]),
        p: anime.popularity,
      };
      if (multi) entry.s = 1;
      if (this.singleThemeAnime(anime.id)) entry.u = 1;
      entries.push(entry);
    }
    return entries;
  }
}
