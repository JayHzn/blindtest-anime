import { MODE_TIMINGS } from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { Vinyl } from '../components/Vinyl';
import { AnswerForm } from '../components/game/AnswerForm';
import { GameSidebar } from '../components/game/GameSidebar';
import { RevealPanel } from '../components/game/RevealPanel';
import { RoundDots } from '../components/game/RoundDots';
import { TierControls } from '../components/game/TierControls';
import { TimerBar } from '../components/game/TimerBar';
import { VolumeControl } from '../components/game/VolumeControl';
import { Button } from '../components/ui/Button';
import type { GameSession, SessionState } from '../game/GameSession';
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
  const now = useServerNow();
  const { phase } = state;

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
              {t(`setup.mode.${state.settings.mode}`)} ·{' '}
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
            <CountdownStage state={state} now={now} />
          ) : null}
          {phase === 'listening' ? (
            <ListeningStage session={session} state={state} now={now} />
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

function CountdownStage({ state, now }: { state: SessionState; now: number }) {
  const { t } = useI18n();
  const seconds = secondsLeft(state.phaseEndsAt, now);
  return (
    <div className={styles.countdown}>
      <Vinyl size={180} spinning={false} />
      {state.phase === 'countdown' && now < state.phaseEndsAt ? (
        <>
          <span key={seconds} className={styles.bigNumber}>
            {seconds}
          </span>
          <p className={styles.caption}>{t('game.getReady')}</p>
        </>
      ) : (
        <p className={styles.caption}>{t('game.loadingAudio')}</p>
      )}
    </div>
  );
}

interface ListeningStageProps {
  session: GameSession;
  state: SessionState;
  now: number;
}

function ListeningStage({ session, state, now }: ListeningStageProps) {
  const { t } = useI18n();
  const index = useTitleIndex();
  const { answer } = state;
  const progressive = state.settings.mode === 'progressive';
  const timing = MODE_TIMINGS[state.settings.mode];

  return (
    <div className={styles.listening}>
      {/* En Progressif, le vinyle ne tourne que pendant l'extrait. */}
      <Vinyl size={progressive ? 150 : 180} spinning={!progressive || state.snippetPlaying} />
      <div className={styles.timer}>
        <div className={styles.timerLabels}>
          <span>{t('game.question')}</span>
          <span className={styles.seconds}>
            {t('game.seconds', { s: secondsLeft(state.phaseEndsAt, now) })}
          </span>
        </div>
        <TimerBar endsAt={state.phaseEndsAt} durationMs={timing.listenMs} />
      </div>

      {progressive && answer.status !== 'correct' ? (
        <TierControls
          progress={state.progress}
          playing={state.snippetPlaying}
          disabled={answer.status === 'eliminated'}
          onReplay={() => session.replay()}
          onNext={() => void session.nextTier()}
        />
      ) : null}

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
      ) : null}

      {answer.status === 'eliminated' ? (
        <div className={styles.eliminated} role="status">
          <span className={styles.eliminatedTitle}>{t('progressive.eliminated')}</span>
          <span className={styles.caption}>{t('progressive.eliminated.hint')}</span>
        </div>
      ) : null}

      {answer.status !== 'correct' && answer.status !== 'eliminated' ? (
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
      ) : null}
    </div>
  );
}
