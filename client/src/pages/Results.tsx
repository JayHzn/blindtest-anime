import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import type { SessionState } from '../game/GameSession';
import { useI18n } from '../i18n/context';
import { formatScore } from '../lib/score';
import { HigherLowerResults } from './HigherLowerResults';
import { ImpostorResults } from './ImpostorResults';
import styles from './Results.module.css';

export type ResultsActions =
  | { kind: 'solo'; onReplay: () => void; onSettings: () => void; onHome: () => void }
  | {
      kind: 'room';
      onBackToLobby: () => void;
      onLeave: () => void;
      /** Code de la room (affiché en Plus ou moins). */
      code?: string;
    };

interface ResultsProps {
  state: SessionState;
  actions: ResultsActions;
}

/** Couleurs du podium (or, argent, bronze). */
const PODIUM = [styles.gold, styles.silver, styles.bronze];

export function Results({ state, actions }: ResultsProps) {
  const { t, lang } = useI18n();
  if (state.settings.mode === 'higherLower') {
    return <HigherLowerResults state={state} actions={actions} />;
  }
  if (state.settings.mode === 'impostor') {
    return <ImpostorResults state={state} actions={actions} />;
  }
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
            <span className={styles.scoreValue}>{formatScore(score)}</span>
            <span className={styles.scoreUnit}>{t('results.points')}</span>
          </div>
          <p className={styles.found}>
            {t('results.found', { found, total: state.history.length })}
          </p>
          {isRecord ? <span className={styles.record}>{t('results.record')}</span> : null}
          {!isRecord && previousBest !== null ? (
            <p className={styles.best}>{t('results.previousBest', { score: previousBest })}</p>
          ) : null}
          <ResultActions actions={actions} />
        </Card>

        {state.players.length > 1 ? (
          <Card className={styles.recap}>
            <h2 className={styles.recapTitle}>{t('results.ranking')}</h2>
            <ol className={styles.rounds}>
              {state.players.map((player, i) => (
                <li
                  key={player.id}
                  className={[styles.round, player.id === state.you ? styles.mine : ''].join(' ')}
                >
                  <span className={[styles.rank, PODIUM[i] ?? ''].join(' ')}>{i + 1}</span>
                  <span className={styles.roundInfo}>
                    <span className={styles.roundTitle}>{player.pseudo}</span>
                  </span>
                  <span className={styles.roundPoints}>{formatScore(player.score)}</span>
                </li>
              ))}
            </ol>
          </Card>
        ) : null}

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
                      {mine?.correct
                        ? `+${mine.points}`
                        : mine && mine.points < 0
                          ? formatScore(mine.points)
                          : '—'}
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

/** Rejouer / réglages / accueil (solo), ou retour au salon (room). */
export function ResultActions({ actions }: { actions: ResultsActions }) {
  const { t } = useI18n();
  return (
    <div className={styles.actions}>
      {actions.kind === 'solo' ? (
        <>
          <Button size="lg" onClick={actions.onReplay}>
            {t('results.replay')}
          </Button>
          <Button size="lg" variant="secondary" onClick={actions.onSettings}>
            {t('results.settings')}
          </Button>
          <Button variant="ghost" onClick={actions.onHome}>
            {t('results.home')}
          </Button>
        </>
      ) : (
        <>
          <Button size="lg" onClick={actions.onBackToLobby}>
            {t('results.backToLobby')}
          </Button>
          <Button variant="ghost" onClick={actions.onLeave}>
            {t('room.leave')}
          </Button>
        </>
      )}
    </div>
  );
}
