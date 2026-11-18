import {
  RIGHT_OP,
  RIGHT_OP_LISTEN_MS,
  RIGHT_OP_ROUND_MS,
  type RoundReveal,
} from '@blindtest/shared';
import type { CSSProperties } from 'react';
import type { GameSession, SessionState } from '../../game/GameSession';
import { secondsLeft } from '../../hooks/useServerNow';
import { useI18n } from '../../i18n/context';
import { avatarColor } from '../../lib/avatar';
import { TimerBar } from './TimerBar';
import styles from './RightOp.module.css';

const LETTERS = ['A', 'B', 'C', 'D'];
/** Hauteurs des barres décoratives de chaque carte (une forme par extrait). */
const WAVES = [
  [40, 75, 55, 90, 35, 65, 80, 45, 60, 30],
  [50, 85, 40, 70, 95, 60, 35, 75, 45, 65],
  [40, 60, 80, 45, 30, 70, 55, 85, 40, 50],
  [65, 35, 55, 90, 40, 75, 30, 60, 85, 45],
];

interface StageProps {
  session: GameSession;
  state: SessionState;
  now: number;
}

/**
 * Le bon OP : l'anime de la manche et ses 4 extraits. Ils passent à la suite (sans
 * chrono), puis 15 s de décompte avec réécoute libre. Un seul choix par manche.
 */
export function RightOpStage({ session, state, now }: StageProps) {
  const { t, lang } = useI18n();
  const view = state.rightOp;
  if (!view) return null;
  const startedAt = state.phaseEndsAt - RIGHT_OP_ROUND_MS;
  const elapsed = now - startedAt;
  const listening = elapsed < RIGHT_OP_LISTEN_MS;
  const playingSlot = state.clip ? state.clip.index % RIGHT_OP.options : null;
  const { yourPick, yourResult } = view;
  const timeUp = yourPick === null && now >= state.phaseEndsAt;
  const multi = state.players.length > 1;

  const statusOf = (slot: number): string => {
    if (yourPick === slot) return t('rightOp.status.yours');
    if (playingSlot === slot) return t('rightOp.status.playing');
    return session.rightOpReplayable(slot) ? t('rightOp.status.heard') : t('rightOp.status.next');
  };

  return (
    <div className={styles.stage}>
      <div className={styles.head}>
        <div
          className={styles.jacket}
          style={
            view.anime.coverColor
              ? ({ '--cover-color': view.anime.coverColor } as CSSProperties)
              : undefined
          }
        >
          {view.anime.coverUrl ? <img src={view.anime.coverUrl} alt="" /> : null}
        </div>
        <div className={styles.headText}>
          <span className={styles.badge}>{t(`theme.${view.anime.type}`)}</span>
          <h1 className={styles.title}>{view.anime.title[lang]}</h1>
          <p className={styles.question}>{t(`rightOp.question.${view.anime.type}`)}</p>
        </div>
      </div>

      <div className={styles.timer}>
        {listening ? (
          <>
            <div className={styles.timerLabels}>
              <span>
                {t('rightOp.listening', {
                  n: Math.min(RIGHT_OP.options, Math.floor(elapsed / RIGHT_OP.snippetMs) + 1),
                })}
              </span>
              <span>{t('rightOp.countdownAfter')}</span>
            </div>
            <div className={styles.listenBar}>
              <span
                style={{
                  width: `${Math.min(100, Math.max(0, (elapsed / RIGHT_OP_LISTEN_MS) * 100))}%`,
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div className={styles.timerLabels}>
              <span>
                {yourPick !== null && multi ? t('rightOp.waitingOthers') : t('rightOp.choose')}
              </span>
              <span className={styles.seconds}>
                {t('game.seconds', {
                  s: Math.min(secondsLeft(state.phaseEndsAt, now), RIGHT_OP.chooseMs / 1000),
                })}
              </span>
            </div>
            <TimerBar endsAt={state.phaseEndsAt} durationMs={RIGHT_OP.chooseMs} />
          </>
        )}
      </div>

      <div className={styles.cards}>
        {LETTERS.map((letter, slot) => {
          const mine = yourPick === slot;
          const classes = [styles.card];
          if (mine)
            classes.push(yourResult?.correct === false ? styles.pickedWrong : styles.picked);
          else if (yourPick !== null) classes.push(styles.dim);
          else if (playingSlot === slot) classes.push(styles.playing);
          else if (!session.rightOpReplayable(slot)) classes.push(styles.later);
          return (
            <section
              key={letter}
              className={classes.join(' ')}
              aria-label={t('rightOp.clip', { l: letter })}
            >
              <div className={styles.cardHead}>
                <span className={styles.letter}>{letter}</span>
                <span className={styles.status}>{statusOf(slot)}</span>
              </div>
              <div className={styles.wave} aria-hidden="true">
                {WAVES[slot]!.map((height, i) => (
                  <i key={i} style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.replay}
                  disabled={!session.rightOpReplayable(slot) || timeUp}
                  aria-label={t('rightOp.replayClip', { l: letter })}
                  onClick={() => session.replayRightOp(slot)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  <span className={styles.replayLabel}>{t('rightOp.replay')}</span>
                </button>
                {yourPick === null ? (
                  <button
                    type="button"
                    className={styles.pick}
                    disabled={timeUp}
                    aria-label={t('rightOp.pickClip', { l: letter })}
                    onClick={() => void session.pickRightOp(slot)}
                  >
                    {t('rightOp.pick')}
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {yourResult ? (
        <div className={styles.feedback} role="status">
          <p className={yourResult.correct ? styles.good : styles.bad}>
            {yourResult.correct ? t('rightOp.good', { n: yourResult.points }) : t('rightOp.bad')}
          </p>
          <p className={styles.hint}>
            {yourResult.correct ? t('rightOp.goodHint') : t('rightOp.badHint')}{' '}
            {multi ? t('rightOp.replayAfter') : ''}
          </p>
        </div>
      ) : timeUp ? (
        <p className={[styles.bad, styles.center].join(' ')} role="status">
          {t('rightOp.timeUp')}
        </p>
      ) : (
        <p className={styles.hint}>{t('rightOp.hint')}</p>
      )}
    </div>
  );
}

/** Le bon OP, révélation : verdict du joueur (gagné, raté avec son choix, pas de réponse). */
export function RightOpVerdict({ reveal, you }: { reveal: RoundReveal; you: string }) {
  const { t } = useI18n();
  const rightOp = reveal.rightOp!;
  const mine = reveal.results.find((result) => result.playerId === you);
  const pick = rightOp.picks.find((p) => p.playerId === you);
  if (mine?.correct) {
    return (
      <span className={[styles.verdict, styles.verdictWin].join(' ')}>
        {t('rightOp.reveal.found', { n: mine.points })}
      </span>
    );
  }
  return (
    <span className={[styles.verdict, styles.verdictLost].join(' ')}>
      {pick
        ? t('rightOp.reveal.missed', { l: LETTERS[pick.index] ?? '?' })
        : t('rightOp.reveal.none')}
    </span>
  );
}

/** Le bon OP, révélation : les 4 extraits retournés, et qui a choisi quoi. */
export function RightOpCards({ reveal, you }: { reveal: RoundReveal; you: string }) {
  const { t, lang } = useI18n();
  const rightOp = reveal.rightOp!;
  const myPick = rightOp.picks.find((p) => p.playerId === you)?.index;
  const pseudoOf = (id: string) => reveal.players.find((player) => player.id === id)?.pseudo ?? '?';

  return (
    <div className={styles.revealCards} aria-label={t('rightOp.reveal.cards')}>
      {rightOp.options.map((option, index) => {
        const mine = myPick === index;
        const classes = [styles.revealCard];
        if (option.correct) classes.push(styles.right);
        else if (mine) classes.push(styles.mine);
        let label = t('rightOp.reveal.trap');
        if (option.correct) label = t('rightOp.reveal.right');
        else if (mine) label = t('rightOp.reveal.yours');
        const pickers = rightOp.picks.filter((p) => p.index === index);
        return (
          <section key={index} className={classes.join(' ')}>
            <div className={styles.cardHead}>
              <span className={styles.revealLetter}>{LETTERS[index]}</span>
              <span className={styles.revealLabel}>{label}</span>
            </div>
            <p className={styles.revealAnime}>{option.title[lang]}</p>
            <p className={styles.revealMeta}>
              {option.song ? `« ${option.song} »` : ''}
              {option.song && option.year ? ' · ' : ''}
              {option.year ?? ''}
            </p>
            <div className={styles.who}>
              {pickers.map((p) => (
                <span
                  key={p.playerId}
                  className={styles.whoAvatar}
                  style={{ background: avatarColor(p.playerId) }}
                  title={pseudoOf(p.playerId)}
                >
                  {pseudoOf(p.playerId).charAt(0).toUpperCase()}
                </span>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
