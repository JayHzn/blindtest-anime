import { MODE_TIMINGS } from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { Vinyl } from '../components/Vinyl';
import { AnswerForm } from '../components/game/AnswerForm';
import { GameSidebar } from '../components/game/GameSidebar';
import { RevealPanel } from '../components/game/RevealPanel';
import { RoundDots } from '../components/game/RoundDots';
import { TimerBar } from '../components/game/TimerBar';
import { VolumeControl } from '../components/game/VolumeControl';
import { Button } from '../components/ui/Button';
import type { GameSession } from '../game/GameSession';
import { useGameSession } from '../game/useGameSession';
import { secondsLeft, useServerNow } from '../hooks/useServerNow';
import { useTitleIndex } from '../hooks/useTitleIndex';
import { useI18n } from '../i18n/context';
import styles from './Game.module.css';

interface GameProps {
  session: GameSession;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onQuit: () => void;
}

export function Game({ session, volume, onVolumeChange, onQuit }: GameProps) {
  const { t } = useI18n();
  const state = useGameSession(session);
  const index = useTitleIndex();
  const now = useServerNow();
  const timing = MODE_TIMINGS[state.settings.mode];
  const { phase, answer } = state;

  const quit = () => {
    if (window.confirm(t('game.quit.confirm'))) onQuit();
  };

  return (
    <div className={styles.page}>
      <AppHeader
        center={
          <>
            <RoundDots
              total={state.totalRounds}
              current={state.round}
              history={state.history}
              you={state.you}
            />
            <span className={styles.roundPill}>
              {t('setup.mode.classic')} ·{' '}
              {t('game.round', { n: state.round + 1, total: state.totalRounds })}
            </span>
          </>
        }
      >
        <VolumeControl volume={volume} onChange={onVolumeChange} />
        <Button variant="secondary" onClick={quit}>
          {t('game.quit')}
        </Button>
      </AppHeader>

      <div className={styles.layout}>
        <main className={styles.stage}>
          {phase === 'countdown' || phase === null ? (
            <div className={styles.countdown}>
              <Vinyl size={180} spinning={false} />
              {phase === 'countdown' && now < state.phaseEndsAt ? (
                <>
                  <span key={secondsLeft(state.phaseEndsAt, now)} className={styles.bigNumber}>
                    {secondsLeft(state.phaseEndsAt, now)}
                  </span>
                  <p className={styles.caption}>{t('game.getReady')}</p>
                </>
              ) : (
                <p className={styles.caption}>{t('game.loadingAudio')}</p>
              )}
            </div>
          ) : null}

          {phase === 'listening' ? (
            <div className={styles.listening}>
              <Vinyl size={180} />
              <div className={styles.timer}>
                <div className={styles.timerLabels}>
                  <span>{t('game.question')}</span>
                  <span className={styles.seconds}>
                    {t('game.seconds', { s: secondsLeft(state.phaseEndsAt, now) })}
                  </span>
                </div>
                <TimerBar endsAt={state.phaseEndsAt} durationMs={timing.listenMs} />
              </div>

              {answer.status === 'correct' ? (
                <div className={styles.correct} role="status">
                  <span className={styles.correctPoints}>+{answer.points}</span>
                  <span className={styles.correctLabel}>{t('game.correct')}</span>
                  <div className={styles.bonuses}>
                    {answer.seasonExact ? (
                      <span className={styles.bonus}>{t('game.bonus.season')} +25</span>
                    ) : null}
                    {answer.sequenceExact ? (
                      <span className={styles.bonus}>{t('game.bonus.sequence')} +25</span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  <AnswerForm
                    key={state.round}
                    index={index}
                    disabled={false}
                    wrongCount={answer.wrongCount}
                    onSubmit={(payload) => void session.submitAnswer(payload)}
                  />
                  <p className={styles.feedback} role="status" aria-live="polite">
                    {answer.status === 'wrong' ? t('game.wrong') : ' '}
                  </p>
                </>
              )}
            </div>
          ) : null}

          {phase === 'reveal' && state.reveal ? (
            <RevealPanel
              key={state.reveal.round}
              reveal={state.reveal}
              session={session}
              you={state.you}
              isLastRound={state.reveal.round + 1 >= state.totalRounds}
            />
          ) : null}
        </main>

        <GameSidebar players={state.players} you={state.you} history={state.history} />
      </div>
    </div>
  );
}
