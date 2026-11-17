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
import { avatarColor } from '../lib/avatar';
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
          {state.soundBlocked ? (
            <button
              type="button"
              className={styles.soundBlocked}
              onClick={() => session.enableSound()}
            >
              {t('game.soundBlocked')} <strong>{t('game.enableSound')}</strong>
            </button>
          ) : null}
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
  // Room : écran d'intro avant la première manche (mode, manches, joueurs, puis 3-2-1).
  if (state.kind === 'room' && state.round === 0 && now < state.phaseEndsAt) {
    return (
      <div className={styles.intro}>
        <h1 className={styles.introTitle}>{t('intro.title')}</h1>
        <p className={styles.introMeta}>
          {t(`setup.mode.${state.settings.mode}`)} · {t('intro.rounds', { n: state.totalRounds })}
        </p>
        <ul className={styles.introPlayers}>
          {state.players.map((player, i) => (
            <li
              key={player.id}
              className={styles.introPlayer}
              style={{ animationDelay: `${i * 120}ms` }}
            >
              <span
                className={styles.introAvatar}
                style={{ background: avatarColor(player.id) }}
                aria-hidden="true"
              >
                {player.pseudo.charAt(0).toUpperCase()}
              </span>
              {player.pseudo}
            </li>
          ))}
        </ul>
        {seconds <= 3 ? (
          <span key={seconds} className={styles.bigNumber}>
            {seconds}
          </span>
        ) : null}
      </div>
    );
  }
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
  const progressive = state.settings.mode === 'progressive';
  const timing = MODE_TIMINGS[state.settings.mode];
  // Son temps est écoulé, mais un retardataire écoute encore : la révélation attend.
  const { answer } = state;
  const stillAnswering = answer.status !== 'correct' && answer.status !== 'eliminated';
  const timeUp = stillAnswering && now > state.phaseEndsAt;

  return (
    <div className={styles.listening}>
      {/* En Progressif, le vinyle ne tourne que pendant l'extrait. */}
      <Vinyl size={progressive ? 150 : 180} spinning={!progressive || state.snippetPlaying} />
      <div className={styles.timer}>
        <div className={styles.timerLabels}>
          <span>{t('game.question')}</span>
          <span className={styles.seconds}>
            {t('game.seconds', {
              // Plafonné : un léger décalage d'horloge ne doit pas afficher « 16 s » sur 15.
              s: Math.min(secondsLeft(state.phaseEndsAt, now), timing.listenMs / 1000),
            })}
          </span>
        </div>
        <TimerBar endsAt={state.phaseEndsAt} durationMs={timing.listenMs} />
      </div>

      {progressive && answer.status !== 'correct' && !timeUp ? (
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

      {timeUp ? (
        <div className={styles.eliminated} role="status">
          <span className={styles.eliminatedTitle}>{t('game.timeUp')}</span>
          <span className={styles.caption}>{t('game.timeUp.hint')}</span>
        </div>
      ) : null}

      {stillAnswering && !timeUp ? (
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
