import Database from 'better-sqlite3';
import {
  compact,
  fuzzyMatch,
  normalize,
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
    for (const theme of this.themeList) this.themes.set(theme.id, theme);

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

  /**
   * Tire `count` musiques au hasard parmi celles qui respectent les filtres,
   * jamais deux fois la même franchise dans une partie.
   */
  pickThemes(filters: ThemeFilters, count: number, random: () => number = Math.random): ThemeRow[] {
    const candidates = this.themeList.filter(this.themeFilter(filters));
    // Mélange de Fisher-Yates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }
    const picked: ThemeRow[] = [];
    const usedFranchises = new Set<number>();
    for (const theme of candidates) {
      const franchiseId = this.anime.get(theme.animeId)!.franchiseId;
      if (usedFranchises.has(franchiseId)) continue;
      usedFranchises.add(franchiseId);
      picked.push(theme);
      if (picked.length === count) break;
    }
    return picked;
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

    const sequenceExact = correct && answer.sequence === theme.sequence;
    return { correct, seasonExact, sequenceExact };
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
      entries.push(entry);
    }
    return entries;
  }
}
