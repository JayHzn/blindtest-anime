import { useState } from 'react';
import { PSEUDO_MAX_LENGTH, ROOM_CODE_LENGTH, normalizeRoomCode } from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ServerStatusPill } from '../components/ServerStatusPill';
import { Vinyl } from '../components/Vinyl';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { TextField } from '../components/ui/TextField';
import { useServerStatus } from '../hooks/useServerStatus';
import { useI18n } from '../i18n/context';
import { storage, STORAGE_KEYS } from '../lib/storage';
import { loadTitleIndex } from '../lib/titles';
import styles from './Home.module.css';

interface HomeProps {
  /** Code reçu par lien d'invitation (`?room=ABCD`). */
  invitedCode: string | null;
  busy: boolean;
  error: string | null;
  onPlaySolo: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
}

export function Home({
  invitedCode,
  busy,
  error,
  onPlaySolo,
  onCreateRoom,
  onJoinRoom,
}: HomeProps) {
  const { t } = useI18n();
  const { status, retry } = useServerStatus();
  const [pseudo, setPseudo] = useState(() => storage.get(STORAGE_KEYS.pseudo) ?? '');
  const [code, setCode] = useState(invitedCode ?? '');
  const ready = status === 'ready';
  const hasPseudo = pseudo.trim().length > 0;
  const validCode = normalizeRoomCode(code);
  // Les rooms demandent un pseudo : les autres doivent savoir qui est qui.
  const canUseRooms = ready && hasPseudo && !busy;

  const onPseudoChange = (value: string) => {
    const next = value.slice(0, PSEUDO_MAX_LENGTH);
    setPseudo(next);
    storage.set(STORAGE_KEYS.pseudo, next.trim());
  };

  // Le serveur est prêt : on commence à charger les titres en avance.
  const prefetchTitles = () => ready && void loadTitleIndex().catch(() => {});

  return (
    <div className={styles.page}>
      <AppHeader>
        <ServerStatusPill status={status} onRetry={retry} />
        <LanguageSwitch />
      </AppHeader>

      <main className={styles.main}>
        <Vinyl size={160} />
        <div className={styles.intro}>
          <h1 className={styles.title}>{t('app.name')}</h1>
          <p className={styles.tagline}>{t('home.tagline')}</p>
        </div>

        <Card className={styles.card}>
          {invitedCode ? (
            <p className={styles.invite}>{t('home.invited', { code: invitedCode })}</p>
          ) : null}

          <TextField
            label={t('home.pseudo.label')}
            placeholder={t('home.pseudo.placeholder')}
            value={pseudo}
            maxLength={PSEUDO_MAX_LENGTH}
            autoComplete="nickname"
            onChange={(event) => onPseudoChange(event.target.value)}
          />

          {invitedCode ? null : (
            <div className={styles.actions}>
              <Button
                size="lg"
                disabled={!ready || busy}
                onClick={onPlaySolo}
                onPointerEnter={prefetchTitles}
              >
                {t('home.playSolo')}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                disabled={!canUseRooms}
                onClick={onCreateRoom}
                onPointerEnter={prefetchTitles}
              >
                {t('home.createRoom')}
              </Button>
            </div>
          )}

          {invitedCode ? null : (
            <div className={styles.separator}>
              <span>{t('home.or')}</span>
            </div>
          )}

          <form
            className={styles.join}
            onSubmit={(event) => {
              event.preventDefault();
              if (validCode && canUseRooms) onJoinRoom(validCode);
            }}
          >
            <TextField
              className={styles.codeField}
              label={t('home.roomCode.label')}
              hideLabel
              placeholder="ABCD"
              value={code}
              maxLength={ROOM_CODE_LENGTH + 1}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            <Button
              type="submit"
              size="lg"
              variant={invitedCode ? 'primary' : 'secondary'}
              disabled={!canUseRooms || !validCode}
              onPointerEnter={prefetchTitles}
            >
              {t('home.joinRoom')}
            </Button>
          </form>

          {ready && !hasPseudo ? <p className={styles.hint}>{t('home.pseudoRequired')}</p> : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </Card>
      </main>
    </div>
  );
}
