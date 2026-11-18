import { MODE_TIMINGS, PLAYLIST, chooserPoints, firstRound } from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { Vinyl } from '../components/Vinyl';
import { AnswerForm } from '../components/game/AnswerForm';
import { AuctionStage } from '../components/game/AuctionStage';
import { GameSidebar } from '../components/game/GameSidebar';
import {
  ImpostorReveal,
  ImpostorSidebar,
  ImpostorStage,
  ImpostorStepPill,
} from '../components/game/Impostor';
import {
  HigherLowerReveal,
  HigherLowerSidebar,
  HigherLowerStage,
  StreakPill,
} from '../components/game/HigherLower';
import { RevealPanel } from '../components/game/RevealPanel';
import { RoundDots } from '../components/game/RoundDots';
import { TierControls } from '../components/game/TierControls';
import { TimerBar } from '../components/game/TimerBar';
import { VolumeControl } from '../components/game/VolumeControl';
import { Button } from '../components/ui/Button';
import { auctionBadges } from '../game/auctionBadges';
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
  const auctionMode = state.settings.mode === 'auction';
  const higherLowerMode = state.settings.mode === 'higherLower';
  const impostorMode = state.settings.mode === 'impostor';

  const quit = () => {
    if (window.confirm(t('game.quit.confirm'))) onQuit();
  };

  return (
    <div className={styles.page}>
      <AppHeader
        center={
          impostorMode ? (
            // Imposteur : la manche et son étape (indices, vote…).
            <>
              <span className={styles.roundPill}>
                {t('setup.mode.impostor')} ·{' '}
                {t('game.round', { n: state.round + 1, total: state.totalRounds })}
              </span>
              <ImpostorStepPill state={state} />
            </>
          ) : higherLowerMode ? (
            // Plus ou moins : pas de nombre de manches fixe, mais une série.
            <>
              <span className={styles.roundPill}>
                {t('setup.mode.higherLower')} · {t('hl.tour', { n: state.round })}
              </span>
              <StreakPill state={state} />
            </>
          ) : (
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
          )
        }
      >
        <VolumeControl volume={volume} onChange={onVolumeChange} />
        <Button variant="secondary" onClick={quit}>
          {t('game.quit')}
        </Button>
      </AppHeader>

      <div className={styles.layout}>
        <main
          className={[styles.stage, higherLowerMode || impostorMode ? styles.stageBare : ''].join(
            ' ',
          )}
        >
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
          {auctionMode &&
          (phase === 'bidding' || phase === 'listening' || phase === 'answering') ? (
            <AuctionStage session={session} state={state} now={now} />
          ) : null}
          {higherLowerMode && phase === 'listening' ? (
            <HigherLowerStage session={session} state={state} now={now} />
          ) : null}
          {impostorMode && phase === 'listening' ? (
            <ImpostorStage session={session} state={state} now={now} />
          ) : null}
          {impostorMode && phase === 'reveal' && state.reveal ? (
            <ImpostorReveal session={session} reveal={state.reveal} state={state} now={now} />
          ) : null}
          {!auctionMode && !higherLowerMode && !impostorMode && phase === 'listening' ? (
            <ListeningStage session={session} state={state} now={now} />
          ) : null}
          {higherLowerMode && phase === 'reveal' && state.reveal ? (
            <HigherLowerReveal reveal={state.reveal} you={state.you} now={now} />
          ) : null}
          {!higherLowerMode && !impostorMode && phase === 'reveal' && state.reveal ? (
            <RevealPanel
              key={state.reveal.round}
              reveal={state.reveal}
              session={session}
              you={state.you}
              isLastRound={state.reveal.round + 1 >= state.totalRounds}
            />
          ) : null}
        </main>

        {impostorMode ? (
          <ImpostorSidebar state={state} />
        ) : higherLowerMode ? (
          <HigherLowerSidebar state={state} now={now} />
        ) : (
          <GameSidebar
            players={state.players}
            you={state.you}
            history={state.history}
            badges={
              auctionMode && state.auction && phase !== 'reveal'
                ? auctionBadges(
                    state.auction,
                    state.players.map((player) => player.id),
                    t,
                  )
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

function CountdownStage({ state, now }: { state: SessionState; now: number }) {
  const { t } = useI18n();
  const seconds = secondsLeft(state.phaseEndsAt, now);
  // Room : écran d'intro avant la première manche (mode, manches, joueurs, puis 3-2-1).
  if (
    state.kind === 'room' &&
    state.round === firstRound(state.settings.mode) &&
    now < state.phaseEndsAt
  ) {
    return (
      <div className={styles.intro}>
        <h1 className={styles.introTitle}>{t('intro.title')}</h1>
        <p className={styles.introMeta}>
          {t(`setup.mode.${state.settings.mode}`)} ·{' '}
          {state.settings.mode === 'higherLower'
            ? t('intro.higherLower')
            : t('intro.rounds', { n: state.totalRounds })}
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
  const playlist = state.settings.mode === 'playlist';
  const timing = MODE_TIMINGS[state.settings.mode];
  // Son temps est écoulé, mais un retardataire écoute encore : la révélation attend.
  const { answer } = state;
  const stillAnswering =
    answer.status !== 'correct' && answer.status !== 'eliminated' && answer.status !== 'gaveUp';
  const timeUp = stillAnswering && now > state.phaseEndsAt;
  const guessWindow = playlist && state.playlist.guessWindowEndsAt !== null;
  const durationMs = guessWindow ? PLAYLIST.guessWindowMs : timing.listenMs;

  if (playlist && state.playlist.ownSong) return <OwnSongStage state={state} now={now} />;

  return (
    <div className={styles.listening}>
      {/* En Progressif, le vinyle ne tourne que pendant l'extrait. */}
      <Vinyl size={progressive ? 150 : 180} spinning={!progressive || state.snippetPlaying} />
      <div className={styles.timer}>
        <div className={styles.timerLabels}>
          <span>
            {guessWindow
              ? t('playlist.guess.window', { s: secondsLeft(state.phaseEndsAt, now) })
              : t('game.question')}
          </span>
          <span className={styles.seconds}>
            {t('game.seconds', {
              // Plafonné : un léger décalage d'horloge ne doit pas afficher « 16 s » sur 15.
              s: Math.min(secondsLeft(state.phaseEndsAt, now), durationMs / 1000),
            })}
          </span>
        </div>
        <TimerBar endsAt={state.phaseEndsAt} durationMs={durationMs} />
        {playlist ? <FoundCount found={state.playlist.found} /> : null}
      </div>

      {progressive && stillAnswering && !timeUp ? (
        <TierControls
          progress={state.progress}
          playing={state.snippetPlaying}
          disabled={false}
          onReplay={() => session.replay()}
          onNext={() => void session.nextTier()}
          onGiveUp={() => void session.giveUp()}
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

      {playlist && answer.status === 'correct' ? (
        <GuessPanel session={session} state={state} />
      ) : null}

      {answer.status === 'eliminated' ? (
        <div className={styles.eliminated} role="status">
          <span className={styles.eliminatedTitle}>{t('progressive.eliminated')}</span>
          <span className={styles.caption}>{t('progressive.eliminated.hint')}</span>
        </div>
      ) : null}

      {answer.status === 'gaveUp' ? (
        <div className={styles.eliminated} role="status">
          <span className={styles.eliminatedTitle}>{t('progressive.gaveUp')}</span>
          <span className={styles.caption}>{t('progressive.gaveUp.hint')}</span>
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

/** Playlist : nombre anonyme de joueurs qui ont trouvé (jamais qui). */
function FoundCount({ found }: { found: number }) {
  const { t } = useI18n();
  let text = t('playlist.found.many', { n: found });
  if (found === 0) text = t('playlist.found.none');
  else if (found === 1) text = t('playlist.found.one');
  return (
    <p className={styles.foundCount} aria-live="polite">
      {text}
    </p>
  );
}

/** Playlist : « Devine qui l'a choisie », proposé dès qu'on a trouvé. Un seul pari. */
function GuessPanel({ session, state }: { session: GameSession; state: SessionState }) {
  const { t } = useI18n();
  const { guess } = state.playlist;
  const candidates = state.players.filter((player) => player.id !== state.you);

  if (guess !== undefined) {
    const name =
      guess === null
        ? t('playlist.guess.nobody')
        : (state.players.find((player) => player.id === guess)?.pseudo ?? '?');
    return (
      <p className={styles.guessDone} role="status">
        {t('playlist.guess.yours', { name })}
      </p>
    );
  }
  return (
    <section className={styles.guess} aria-label={t('playlist.guess.title')}>
      <h2 className={styles.guessTitle}>{t('playlist.guess.title')}</h2>
      <p className={styles.guessHint}>{t('playlist.guess.hint')}</p>
      <div className={styles.guessOptions}>
        {candidates.map((player) => (
          <button
            key={player.id}
            type="button"
            className={styles.guessOption}
            onClick={() => void session.guess(player.id)}
          >
            <span
              className={styles.guessAvatar}
              style={{ background: avatarColor(player.id) }}
              aria-hidden="true"
            >
              {player.pseudo.charAt(0).toUpperCase()}
            </span>
            {player.pseudo}
          </button>
        ))}
        <button
          type="button"
          className={[styles.guessOption, styles.guessNobody].join(' ')}
          onClick={() => void session.guess(null)}
        >
          {t('playlist.guess.nobody')}
        </button>
      </div>
    </section>
  );
}

/**
 * Playlist : écran de qui a choisi la chanson. Il écoute sans répondre et voit
 * en direct qui la trouve (lui seul reçoit cette information).
 */
function OwnSongStage({ state, now }: { state: SessionState; now: number }) {
  const { t } = useI18n();
  const timing = MODE_TIMINGS.playlist;
  const others = state.players.filter((player) => player.id !== state.you);
  const answerers = others.filter((player) => player.connected || player.found);
  const found = answerers.filter((player) => player.found).length;
  const potential = chooserPoints(answerers.length, found);
  const guessWindow = state.playlist.guessWindowEndsAt !== null;
  const durationMs = guessWindow ? PLAYLIST.guessWindowMs : timing.listenMs;

  return (
    <div className={styles.ownSong}>
      <span className={styles.ownBadge}>{t('playlist.ownSong.badge')}</span>
      <h1 className={styles.ownTitle}>{t('playlist.ownSong.title')}</h1>
      <p className={styles.ownText}>{t('playlist.ownSong.text')}</p>

      <div className={styles.timer}>
        <div className={styles.timerLabels}>
          <span>{t('playlist.ownSong.listening')}</span>
          <span className={styles.seconds}>
            {t('game.seconds', {
              s: Math.min(secondsLeft(state.phaseEndsAt, now), durationMs / 1000),
            })}
          </span>
        </div>
        <TimerBar endsAt={state.phaseEndsAt} durationMs={durationMs} />
      </div>

      <ul className={styles.watchList}>
        {others.map((player) => (
          <li
            key={player.id}
            className={[
              styles.watchItem,
              player.found ? styles.watchFound : '',
              player.connected ? '' : styles.watchOffline,
            ].join(' ')}
          >
            <span
              className={styles.guessAvatar}
              style={{ background: avatarColor(player.id) }}
              aria-hidden="true"
            >
              {player.pseudo.charAt(0).toUpperCase()}
            </span>
            <span className={styles.watchName}>{player.pseudo}</span>
            <span className={styles.watchState}>
              {player.found ? t('playlist.ownSong.found') : t('playlist.ownSong.searching')}
            </span>
          </li>
        ))}
      </ul>

      <div className={styles.potential}>
        <span className={styles.potentialPoints}>+{potential}</span>
        <span className={styles.potentialText}>
          {potential > 0
            ? t('playlist.ownSong.points', { n: answerers.length - found })
            : t('playlist.ownSong.rule')}
        </span>
      </div>
      <p className={styles.ownSecret}>{t('playlist.ownSong.secret')}</p>
    </div>
  );
}
