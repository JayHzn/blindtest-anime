import { useState } from 'react';
import type { GameSettings } from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { SettingsForm } from '../components/SettingsForm';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useThemeCountMessage } from '../hooks/useThemeCount';
import { useTitleIndex } from '../hooks/useTitleIndex';
import { useI18n } from '../i18n/context';
import { loadSavedSettings, saveSettings } from '../lib/savedSettings';
import styles from './Setup.module.css';

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

      <main className={styles.main}>
        <div className={styles.titleRow}>
          <Button variant="ghost" onClick={onBack}>
            ← {t('setup.back')}
          </Button>
          <h1 className={styles.title}>{t('setup.title')}</h1>
        </div>

        <Card className={styles.card}>
          <SettingsForm settings={settings} onChange={update} />

          <div className={styles.footer}>
            <p className={styles.count} aria-live="polite">
              {message}
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
