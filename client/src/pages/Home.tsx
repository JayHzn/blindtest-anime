import { useState } from 'react';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ServerStatusPill } from '../components/ServerStatusPill';
import { Vinyl } from '../components/Vinyl';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TextField } from '../components/ui/TextField';
import { useServerStatus } from '../hooks/useServerStatus';
import { useI18n } from '../i18n/context';
import { storage, STORAGE_KEYS } from '../lib/storage';
import styles from './Home.module.css';

const PSEUDO_MAX_LENGTH = 20;

export function Home() {
  const { t } = useI18n();
  const { status, retry } = useServerStatus();
  const [pseudo, setPseudo] = useState(() => storage.get(STORAGE_KEYS.pseudo) ?? '');

  const onPseudoChange = (value: string) => {
    const next = value.slice(0, PSEUDO_MAX_LENGTH);
    setPseudo(next);
    storage.set(STORAGE_KEYS.pseudo, next.trim());
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo}>
          blindtest <span className={styles.logoAccent}>anime</span> ♪
        </span>
        <div className={styles.headerRight}>
          <ServerStatusPill status={status} onRetry={retry} />
          <LanguageSwitch />
        </div>
      </header>

      <main className={styles.main}>
        <Vinyl size={180} />
        <div className={styles.intro}>
          <h1 className={styles.title}>{t('app.name')}</h1>
          <p className={styles.tagline}>{t('home.tagline')}</p>
        </div>

        <Card className={styles.card}>
          <TextField
            label={t('home.pseudo.label')}
            placeholder={t('home.pseudo.placeholder')}
            value={pseudo}
            maxLength={PSEUDO_MAX_LENGTH}
            autoComplete="nickname"
            onChange={(event) => onPseudoChange(event.target.value)}
          />
          <div className={styles.actions}>
            <Button size="lg" disabled badge={t('home.soon')}>
              {t('home.playSolo')}
            </Button>
            <Button size="lg" variant="secondary" disabled badge={t('home.soon')}>
              {t('home.createRoom')}
            </Button>
          </div>
        </Card>
      </main>
    </div>
  );
}
