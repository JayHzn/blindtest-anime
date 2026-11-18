import {
  IMPOSTOR,
  PLAYLIST,
  POPULARITY_TIERS,
  SOLO_MODES,
  pickingDurationMs,
  type GameModeId,
  type GameSettings,
  type PopularityTier,
  type ThemeType,
} from '@blindtest/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/fr';
import { ModeRules } from './ModeRules';
import { ChipGroup } from './ui/ChipGroup';
import styles from './SettingsForm.module.css';

const ROUND_OPTIONS = [5, 10, 15, 20];
const PLAYABLE_TYPES: ThemeType[] = ['OP', 'ED'];
const SONG_OPTIONS = Array.from(
  { length: PLAYLIST.songsMax - PLAYLIST.songsMin + 1 },
  (_, i) => PLAYLIST.songsMin + i,
);

interface YearPreset {
  id: string;
  label: MessageKey | string;
  from?: number;
  to?: number;
}

const YEAR_PRESETS: YearPreset[] = [
  { id: 'all', label: 'setup.years.all' },
  { id: '-1999', label: '< 2000', to: 1999 },
  { id: '2000-2009', label: '2000–2009', from: 2000, to: 2009 },
  { id: '2010-2019', label: '2010–2019', from: 2010, to: 2019 },
  { id: '2020-', label: '2020+', from: 2020 },
];

const presetOf = (settings: GameSettings): string =>
  YEAR_PRESETS.find(
    (preset) => preset.from === settings.filters.yearFrom && preset.to === settings.filters.yearTo,
  )?.id ?? 'all';

interface SettingsFormProps {
  settings: GameSettings;
  onChange: (settings: GameSettings) => void;
  /** Lecture seule (joueurs d'une room qui ne sont pas l'hôte). */
  disabled?: boolean;
  /** Modes proposés (les modes multi, Playlist et Enchères, n'existent qu'en room). */
  modes?: readonly GameModeId[];
  /** Règles du mode dans la grille des modes (`false` : la page les affiche ailleurs). */
  showRules?: boolean;
}

/** Réglages d'une partie : mode, manches, popularité, types, années. */
export function SettingsForm({
  settings,
  onChange,
  disabled = false,
  modes = SOLO_MODES,
  showRules = true,
}: SettingsFormProps) {
  const { t } = useI18n();
  const grid = useRef<HTMLDivElement>(null);
  const [rulesSpan, setRulesSpan] = useState(1);

  // Carte des règles : elle prend toute la place libre à droite du dernier mode
  // (ou une ligne entière si la dernière ligne est pleine). Le nombre de colonnes
  // dépend de la largeur : recalculé quand la grille change de taille.
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const update = () => {
      const columns = getComputedStyle(element).gridTemplateColumns.split(' ').length;
      const free = columns - (modes.length % columns);
      setRulesSpan(free === 0 ? columns : free);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [modes.length]);
  const playlist = settings.mode === 'playlist';
  const higherLower = settings.mode === 'higherLower';
  const songsPerPlayer = settings.songsPerPlayer ?? PLAYLIST.songsDefault;

  const updateFilters = (patch: Partial<GameSettings['filters']>) =>
    onChange({ ...settings, filters: { ...settings.filters, ...patch } });

  const toggleType = (type: ThemeType) => {
    const types = settings.filters.types.includes(type)
      ? settings.filters.types.filter((current) => current !== type)
      : [...settings.filters.types, type];
    if (types.length > 0) updateFilters({ types });
  };

  const selectYears = (id: string) => {
    const preset = YEAR_PRESETS.find((p) => p.id === id)!;
    const filters = { ...settings.filters };
    delete filters.yearFrom;
    delete filters.yearTo;
    if (preset.from !== undefined) filters.yearFrom = preset.from;
    if (preset.to !== undefined) filters.yearTo = preset.to;
    onChange({ ...settings, filters });
  };

  return (
    <div className={styles.form}>
      <section className={styles.section}>
        <h2 className={styles.label}>{t('setup.mode')}</h2>
        <div
          ref={grid}
          className={styles.modes}
          role="radiogroup"
          aria-label={t('setup.mode')}
          data-mode-grid=""
        >
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={settings.mode === mode}
              disabled={disabled && settings.mode !== mode}
              className={[styles.mode, settings.mode === mode ? styles.modeActive : ''].join(' ')}
              onClick={() => !disabled && onChange({ ...settings, mode })}
            >
              <span className={styles.modeName}>{t(`setup.mode.${mode}`)}</span>
              <span className={styles.modeDesc}>{t(`setup.mode.${mode}.desc`)}</span>
            </button>
          ))}
          {/* Règles du mode choisi, dans la place libre de la grille : visibles par tous. */}
          {showRules ? (
            <ModeRules mode={settings.mode} style={{ gridColumn: `span ${rulesSpan}` }} />
          ) : null}
        </div>
      </section>

      {playlist ? (
        <section className={styles.section}>
          <h2 className={styles.label}>
            {t('setup.songsPerPlayer')}{' '}
            <span className={styles.hint}>
              {t('setup.songsPerPlayer.hint', { s: pickingDurationMs(songsPerPlayer) / 1000 })}
            </span>
          </h2>
          <ChipGroup
            label={t('setup.songsPerPlayer')}
            options={SONG_OPTIONS.map((value) => ({
              value,
              label: String(value),
              disabled: disabled && value !== songsPerPlayer,
            }))}
            selected={[songsPerPlayer]}
            onToggle={(value) => !disabled && onChange({ ...settings, songsPerPlayer: value })}
          />
        </section>
      ) : higherLower ? (
        // Plus ou moins : la partie dure jusqu'à l'erreur, pas de réglage de manches.
        <p className={styles.note}>{t('setup.higherLower.note')}</p>
      ) : (
        <section className={styles.section}>
          <h2 className={styles.label}>{t('setup.rounds')}</h2>
          <ChipGroup
            label={t('setup.rounds')}
            options={ROUND_OPTIONS.map((value) => ({
              value,
              label: String(value),
              disabled: disabled && value !== settings.rounds,
            }))}
            selected={[settings.rounds]}
            onToggle={(rounds) => !disabled && onChange({ ...settings, rounds })}
          />
        </section>
      )}

      {settings.mode === 'impostor' ? (
        <section className={styles.section}>
          <h2 className={styles.label}>{t('setup.voteMs')}</h2>
          <ChipGroup
            label={t('setup.voteMs')}
            options={IMPOSTOR.voteOptionsMs.map((value) => ({
              value,
              label: t('game.seconds', { s: value / 1000 }),
              disabled: disabled && value !== (settings.voteMs ?? IMPOSTOR.voteDefaultMs),
            }))}
            selected={[settings.voteMs ?? IMPOSTOR.voteDefaultMs]}
            onToggle={(voteMs) => !disabled && onChange({ ...settings, voteMs })}
          />
          <p className={styles.note}>{t('setup.impostor.note')}</p>
        </section>
      ) : null}

      {playlist ? <p className={styles.note}>{t('setup.playlist.filtersNote')}</p> : null}

      <section className={styles.section}>
        <h2 className={styles.label}>
          {t('setup.popularity')} <span className={styles.hint}>{t('setup.popularity.hint')}</span>
        </h2>
        <ChipGroup<PopularityTier>
          label={t('setup.popularity')}
          options={POPULARITY_TIERS.map((value) => ({
            value,
            label: t(`setup.popularity.${value}`),
            disabled: disabled && value !== settings.filters.popularity,
          }))}
          selected={[settings.filters.popularity]}
          onToggle={(popularity) => !disabled && updateFilters({ popularity })}
        />
      </section>

      <div className={styles.columns}>
        <section className={styles.section}>
          <h2 className={styles.label}>{t('setup.types')}</h2>
          <ChipGroup<ThemeType>
            label={t('setup.types')}
            multiple
            options={PLAYABLE_TYPES.map((value) => ({
              value,
              label: t(`setup.type.${value as 'OP' | 'ED'}`),
              disabled: disabled && !settings.filters.types.includes(value),
            }))}
            selected={settings.filters.types}
            onToggle={(type) => !disabled && toggleType(type)}
          />
        </section>

        <section className={styles.section}>
          <h2 className={styles.label}>{t('setup.years')}</h2>
          <ChipGroup
            label={t('setup.years')}
            options={YEAR_PRESETS.map((preset) => ({
              value: preset.id,
              label: preset.label.startsWith('setup.')
                ? t(preset.label as MessageKey)
                : preset.label,
              disabled: disabled && preset.id !== presetOf(settings),
            }))}
            selected={[presetOf(settings)]}
            onToggle={(id) => !disabled && selectYears(id)}
          />
        </section>
      </div>
    </div>
  );
}
