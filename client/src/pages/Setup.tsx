import { useLayoutEffect, useRef, useState } from 'react';
import type { GameSettings } from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ModeRules } from '../components/ModeRules';
import { SettingsForm } from '../components/SettingsForm';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useThemeCountMessage } from '../hooks/useThemeCount';
import { useTitleIndex } from '../hooks/useTitleIndex';
import { useI18n } from '../i18n/context';
import { loadSavedSettings, saveSettings } from '../lib/savedSettings';
import styles from './Setup.module.css';

/** Largeur à partir de laquelle la marge de droite accueille les règles (voir Setup.module.css). */
const WIDE_QUERY = '(min-width: 1400px)';

interface SetupProps {
  error: string | null;
  starting: boolean;
  onBack: () => void;
  onStart: (settings: GameSettings) => void;
}

export function Setup({ error, starting, onBack, onStart }: SetupProps) {
  const { t } = useI18n();
  const [settings, setSettings] = useState(loadSavedSettings);
  const { count, message } = useThemeCountMessage(settings);
  // Assez de marge à droite du formulaire pour y poser les règles.
  const wide = useMediaQuery(WIDE_QUERY);
  const layout = useRef<HTMLDivElement>(null);
  const [asideTop, setAsideTop] = useState(0);

  // Les règles s'alignent sur le haut des cartes de mode (mesuré : la hauteur du
  // titre et du libellé « Mode » dépend de la police et de la langue).
  useLayoutEffect(() => {
    const element = layout.current;
    if (!wide || !element) return;
    const update = () => {
      const modes = element.querySelector('[data-mode-grid]');
      if (!modes) return;
      setAsideTop(modes.getBoundingClientRect().top - element.getBoundingClientRect().top);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [wide]);
  // Préchargement de l'index des titres pendant que le joueur règle sa partie.
  useTitleIndex();

  const update = (next: GameSettings) => {
    setSettings(next);
    saveSettings(next);
  };

  return (
    <div className={styles.page}>
      <AppHeader>
        <LanguageSwitch />
      </AppHeader>

      <div ref={layout} className={styles.layout}>
        <main className={styles.main}>
          <div className={styles.titleRow}>
            <Button variant="ghost" onClick={onBack}>
              ← {t('setup.back')}
            </Button>
            <h1 className={styles.title}>{t('setup.title')}</h1>
          </div>

          <Card className={styles.card}>
            <SettingsForm settings={settings} onChange={update} showRules={!wide} />

            <div className={styles.footer}>
              <p className={styles.count} aria-live="polite">
                {message}
              </p>
              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                size="lg"
                disabled={starting || count === 0}
                onClick={() => onStart(settings)}
              >
                {starting ? t('setup.starting') : t('setup.start')}
              </Button>
            </div>
          </Card>
        </main>
        {/* Grand écran : règles dans la marge de droite, à la hauteur des cartes de mode. */}
        {wide ? (
          <aside
            className={styles.aside}
            style={{ marginTop: asideTop }}
            aria-label={t('setup.rules')}
          >
            <ModeRules mode={settings.mode} variant="aside" />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
