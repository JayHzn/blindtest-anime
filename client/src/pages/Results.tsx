import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import type { SessionState } from '../game/GameSession';
import { useI18n } from '../i18n/context';
import styles from './Results.module.css';

interface ResultsProps {
  state: SessionState;
  onReplay: () => void;
  onSettings: () => void;
  onHome: () => void;
}

export function Results({ state, onReplay, onSettings, onHome }: ResultsProps) {
  const { t, lang } = useI18n();
  const me = state.players.find((player) => player.id === state.you);
  const score = me?.score ?? 0;
  const found = state.history.filter(
    (reveal) => reveal.results.find((r) => r.playerId === state.you)?.correct,
  ).length;
  const interrupted = state.end?.reason === 'audio_unavailable';
  const { previousBest } = state;
  const isRecord = previousBest !== null && score > previousBest;

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={styles.main}>
        <Card className={styles.summary}>
          <h1 className={styles.title}>{t('results.title')}</h1>
          {interrupted ? <p className={styles.warning}>{t('results.audioUnavailable')}</p> : null}
          <div className={styles.score}>
            <span className={styles.scoreValue}>{score}</span>
            <span className={styles.scoreUnit}>{t('results.points')}</span>
          </div>
          <p className={styles.found}>
            {t('results.found', { found, total: state.history.length })}
          </p>
          {isRecord ? <span className={styles.record}>{t('results.record')}</span> : null}
          {!isRecord && previousBest !== null ? (
            <p className={styles.best}>{t('results.previousBest', { score: previousBest })}</p>
          ) : null}
          <div className={styles.actions}>
            <Button size="lg" onClick={onReplay}>
              {t('results.replay')}
            </Button>
            <Button size="lg" variant="secondary" onClick={onSettings}>
              {t('results.settings')}
            </Button>
            <Button variant="ghost" onClick={onHome}>
              {t('results.home')}
            </Button>
          </div>
        </Card>

        {state.history.length > 0 ? (
          <Card className={styles.recap}>
            <h2 className={styles.recapTitle}>{t('results.rounds')}</h2>
            <ol className={styles.rounds}>
              {state.history.map((reveal) => {
                const mine = reveal.results.find((r) => r.playerId === state.you);
                return (
                  <li key={reveal.round} className={styles.round}>
                    <span className={styles.roundNumber}>{reveal.round + 1}</span>
                    <span className={styles.roundInfo}>
                      <span className={styles.roundTitle}>{reveal.anime.title[lang]}</span>
                      <span className={styles.roundSong}>
                        {t(`theme.${reveal.theme.type}`)} {reveal.theme.sequence}
                        {reveal.theme.song ? ` · « ${reveal.theme.song} »` : ''}
                      </span>
                    </span>
                    <span
                      className={[styles.roundPoints, mine?.correct ? styles.roundFound : ''].join(
                        ' ',
                      )}
                    >
                      {mine?.correct ? `+${mine.points}` : '—'}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>
        ) : null}
      </main>
    </div>
  );
}
