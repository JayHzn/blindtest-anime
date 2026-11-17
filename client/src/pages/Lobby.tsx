import { useState, useSyncExternalStore } from 'react';
import { ROOM_MAX_PLAYERS, type GameSettings } from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { SettingsForm } from '../components/SettingsForm';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { roomLink, type RoomSession } from '../game/RoomSession';
import { useThemeCountMessage } from '../hooks/useThemeCount';
import { useTitleIndex } from '../hooks/useTitleIndex';
import { useI18n } from '../i18n/context';
import { avatarColor } from '../lib/avatar';
import { unlockSfx } from '../lib/sfx';
import { saveSettings } from '../lib/savedSettings';
import styles from './Lobby.module.css';

interface LobbyProps {
  session: RoomSession;
  onLeave: () => void;
}

/** Salon d'une room : code à partager, joueurs, réglages (hôte) et lancement. */
export function Lobby({ session, onLeave }: LobbyProps) {
  const { t } = useI18n();
  const { room } = useSyncExternalStore(session.subscribe, session.getState);
  const isHost = room.hostId === room.you;
  const me = room.members.find((member) => member.id === room.you);
  const notReady = room.members.filter(
    (member) => member.connected && !member.isHost && !member.ready,
  );
  const { count, message } = useThemeCountMessage(room.settings);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Préchargement de l'index des titres pendant l'attente.
  useTitleIndex();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomLink(room.code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // presse-papiers refusé : le code reste lisible à l'écran
    }
  };

  const changeSettings = (settings: GameSettings) => {
    session.updateSettings(settings);
    saveSettings(settings);
  };

  const start = async () => {
    unlockSfx();
    setStarting(true);
    setError(null);
    const failure = await session.start();
    setStarting(false);
    if (failure) setError(t(`error.${failure}`));
  };

  const leave = () => {
    if (window.confirm(t('room.leave.confirm'))) onLeave();
  };

  return (
    <div className={styles.page}>
      <AppHeader>
        <LanguageSwitch />
        <Button variant="secondary" onClick={leave}>
          {t('room.leave')}
        </Button>
      </AppHeader>

      <main className={styles.layout}>
        <Card className={styles.side}>
          <section className={styles.codeBlock}>
            <span className={styles.codeLabel}>{t('room.code')}</span>
            <span className={styles.code} aria-label={room.code.split('').join(' ')}>
              {room.code}
            </span>
            <Button variant="secondary" onClick={() => void copyLink()}>
              {copied ? t('room.linkCopied') : t('room.copyLink')}
            </Button>
          </section>

          <section className={styles.players}>
            <h2 className={styles.heading}>
              {t('room.players', { n: room.members.length, max: ROOM_MAX_PLAYERS })}
            </h2>
            <ul className={styles.memberList}>
              {room.members.map((member) => (
                <li
                  key={member.id}
                  className={[styles.member, member.connected ? '' : styles.offline].join(' ')}
                >
                  <span
                    className={styles.avatar}
                    style={{ background: avatarColor(member.id) }}
                    aria-hidden="true"
                  >
                    {member.pseudo.charAt(0).toUpperCase()}
                  </span>
                  <span className={styles.name}>
                    {member.pseudo}
                    {member.id === room.you ? (
                      <span className={styles.you}> ({t('room.you')})</span>
                    ) : null}
                  </span>
                  {member.isHost ? <span className={styles.badge}>{t('room.host')}</span> : null}
                  {member.connected && !member.isHost && member.ready ? (
                    <span className={styles.readyTag}>✓ {t('room.readyTag')}</span>
                  ) : null}
                  {member.connected ? null : (
                    <span className={styles.offlineTag}>{t('room.offline')}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </Card>

        <Card className={styles.settings}>
          <div className={styles.settingsHeader}>
            <h2 className={styles.heading}>{t('room.settings')}</h2>
            {isHost ? null : <span className={styles.hint}>{t('room.settings.hostOnly')}</span>}
          </div>
          <SettingsForm settings={room.settings} onChange={changeSettings} disabled={!isHost} />

          <div className={styles.footer}>
            <p className={styles.count} aria-live="polite">
              {message}
            </p>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            {isHost ? (
              <>
                <Button
                  size="lg"
                  disabled={starting || count === 0 || notReady.length > 0}
                  onClick={() => void start()}
                >
                  {starting ? t('setup.starting') : t('room.start')}
                </Button>
                {notReady.length > 0 ? (
                  <p className={styles.hint}>
                    {t('room.waitingPlayers', { names: notReady.map((m) => m.pseudo).join(', ') })}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                {/* Le clic débloque aussi le son, que les navigateurs coupent sans action. */}
                <Button
                  size="lg"
                  variant={me?.ready ? 'secondary' : 'primary'}
                  onClick={() => {
                    unlockSfx();
                    session.setReady(!me?.ready);
                  }}
                >
                  {me?.ready ? t('room.unready') : t('room.ready')}
                </Button>
                {me?.ready ? <p className={styles.waiting}>{t('room.waitingHost')}</p> : null}
              </>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
