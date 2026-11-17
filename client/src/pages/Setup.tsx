import { useState } from 'react';
import {
  DEFAULT_SETTINGS,
  GAME_MODES,
  POPULARITY_TIERS,
  sanitizeSettings,
  type GameSettings,
  type PopularityTier,
  type ThemeType,
} from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ChipGroup } from '../components/ui/ChipGroup';
import { useThemeCount } from '../hooks/useThemeCount';
import { useTitleIndex } from '../hooks/useTitleIndex';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/fr';
import { storage, STORAGE_KEYS } from '../lib/storage';
import styles from './Setup.module.css';

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

function loadSavedSettings(): GameSettings {
  return sanitizeSettings(storage.getJson(STORAGE_KEYS.settings)) ?? DEFAULT_SETTINGS;
}

interface SetupProps {
  error: string | null;
  starting: boolean;
  onBack: () => void;
  onStart: (settings: GameSettings) => void;
}

export function Setup({ error, starting, onBack, onStart }: SetupProps) {
  const { t } = useI18n();
  const [settings, setSettings] = useState(loadSavedSettings);
  const count = useThemeCount(settings.filters);
  // Préchargement de l'index des titres pendant que le joueur règle sa partie.
  useTitleIndex();

  const update = (next: GameSettings) => {
    setSettings(next);
    storage.setJson(STORAGE_KEYS.settings, next);
  };
  const updateFilters = (patch: Partial<GameSettings['filters']>) =>
    update({ ...settings, filters: { ...settings.filters, ...patch } });

  const toggleType = (type: ThemeType) => {
    const types = settings.filters.types.includes(type)
      ? settings.filters.types.filter((t) => t !== type)
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
    update({ ...settings, filters });
  };

  const countMessage =
    count === null
      ? '…'
      : count === 0
        ? t('setup.count.none')
        : count < settings.rounds
          ? t('setup.count.few', { count })
          : t('setup.count', { count: count.toLocaleString() });

  return (
    <div className={styles.page}>
      <AppHeader>
        <LanguageSwitch />
      </AppHeader>

      <main className={styles.main}>
        <div className={styles.titleRow}>
          <Button variant="ghost" onClick={onBack}>
            ← {t('setup.back')}
          </Button>
          <h1 className={styles.title}>{t('setup.title')}</h1>
        </div>

        <Card className={styles.card}>
          <section className={styles.section}>
            <h2 className={styles.label}>{t('setup.mode')}</h2>
            <div className={styles.modes} role="radiogroup" aria-label={t('setup.mode')}>
              {GAME_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={settings.mode === mode}
                  className={[styles.mode, settings.mode === mode ? styles.modeActive : ''].join(
                    ' ',
                  )}
                  onClick={() => update({ ...settings, mode })}
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
              options={ROUND_OPTIONS.map((value) => ({ value, label: String(value) }))}
              selected={[settings.rounds]}
              onToggle={(rounds) => update({ ...settings, rounds })}
            />
          </section>

          <section className={styles.section}>
            <h2 className={styles.label}>
              {t('setup.popularity')}{' '}
              <span className={styles.hint}>{t('setup.popularity.hint')}</span>
            </h2>
            <ChipGroup<PopularityTier>
              label={t('setup.popularity')}
              options={POPULARITY_TIERS.map((value) => ({
                value,
                label: t(`setup.popularity.${value}`),
              }))}
              selected={[settings.filters.popularity]}
              onToggle={(popularity) => updateFilters({ popularity })}
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
                }))}
                selected={settings.filters.types}
                onToggle={toggleType}
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
                }))}
                selected={[presetOf(settings)]}
                onToggle={selectYears}
              />
            </section>
          </div>

          <div className={styles.footer}>
            <p className={styles.count} aria-live="polite">
              {countMessage}
            </p>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <Button size="lg" disabled={starting || count === 0} onClick={() => onStart(settings)}>
              {starting ? t('setup.starting') : t('setup.start')}
            </Button>
          </div>
        </Card>
      </main>
    </div>
  );
}
