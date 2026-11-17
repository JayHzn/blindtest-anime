import {
  GAME_MODES,
  POPULARITY_TIERS,
  type GameSettings,
  type PopularityTier,
  type ThemeType,
} from '@blindtest/shared';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/fr';
import { ChipGroup } from './ui/ChipGroup';
import styles from './SettingsForm.module.css';

const ROUND_OPTIONS = [5, 10, 15, 20];
const PLAYABLE_TYPES: ThemeType[] = ['OP', 'ED'];

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
}

/** Réglages d'une partie : mode, manches, popularité, types, années. */
export function SettingsForm({ settings, onChange, disabled = false }: SettingsFormProps) {
  const { t } = useI18n();

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
        <div className={styles.modes} role="radiogroup" aria-label={t('setup.mode')}>
          {GAME_MODES.map((mode) => (
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
        </div>
      </section>

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
