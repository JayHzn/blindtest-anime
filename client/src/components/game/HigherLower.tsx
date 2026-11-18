import type { ReactNode } from 'react';
import {
  HIGHER_LOWER,
  higherLowerListenMs,
  isAlive,
  pickOpensAfterMs,
  type HigherLowerCard,
  type HigherLowerPick,
  type PlayerScore,
  type RoundReveal,
} from '@blindtest/shared';
import type { GameSession, SessionState } from '../../game/GameSession';
import { secondsLeft } from '../../hooks/useServerNow';
import {
  cardMeta,
  formatMembers,
  formatRatio,
  pickLabel,
  pickShort,
  windowLabel,
} from '../../game/higherLowerFormat';
import { useI18n } from '../../i18n/context';
import { avatarColor } from '../../lib/avatar';
import { Vinyl } from '../Vinyl';
import { TimerBar } from './TimerBar';
import sidebar from './GameSidebar.module.css';
import styles from './HigherLower.module.css';

const pseudoOf = (players: PlayerScore[], id: string) =>
  players.find((player) => player.id === id)?.pseudo ?? '?';

// ─── Carte d'une chanson ─────────────────────────────────────────────────────

interface SongCardProps {
  letter: string;
  /** Chanson révélée (référence, ou révélation) ; absente : titre caché, vinyle. */
  card?: HigherLowerCard | null;
  playing?: boolean;
  winner?: boolean;
  /** Badge « Plus populaire » sur la jaquette. */
  more?: boolean;
  label: string;
  children?: ReactNode;
}

function SongCard({
  letter,
  card,
  playing = false,
  winner = false,
  more,
  label,
  children,
}: SongCardProps) {
  const { t, lang } = useI18n();
  return (
    <section
      className={[styles.card, playing ? styles.playing : '', winner ? styles.winner : ''].join(
        ' ',
      )}
      aria-label={label}
    >
      <div
        className={styles.cover}
        style={card?.coverColor ? { background: card.coverColor } : undefined}
      >
        <span className={styles.letter}>{letter}</span>
        {card?.coverUrl ? (
          <img className={styles.coverImage} src={card.coverUrl} alt="" loading="lazy" />
        ) : card ? null : (
          <Vinyl size={140} spinning={playing} />
        )}
        {more ? <span className={styles.more}>{t('hl.reveal.more')}</span> : null}
      </div>
      {card ? (
        <>
          <p className={styles.title}>{card.title[lang]}</p>
          <p className={styles.meta}>{cardMeta(card)}</p>
        </>
      ) : (
        <>
          <p className={styles.title}>???</p>
          <p className={styles.meta}>{t('hl.card.hidden')}</p>
        </>
      )}
      {children}
    </section>
  );
}

function Members({ card, animate = false }: { card: HigherLowerCard; animate?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <span className={[styles.members, animate ? styles.counted : ''].join(' ')}>
      {formatMembers(card.popularity, lang)} <small>{t('hl.members')}</small>
    </span>
  );
}

// ─── Écoute et choix ──────────────────────────────────────────────────────────

interface StageProps {
  session: GameSession;
  state: SessionState;
  now: number;
}

/** Tour en cours : les deux chansons, le chrono, et les deux choix. */
export function HigherLowerStage({ session, state, now }: StageProps) {
  const { t, lang } = useI18n();
  const view = state.higherLower;
  const tour = state.round;
  const { snippetMs } = HIGHER_LOWER;
  const listenMs = higherLowerListenMs(tour);
  const startedAt = state.phaseEndsAt - listenMs;
  const snippetsEnd = startedAt + (tour === 1 ? 2 : 1) * snippetMs;
  const opensAt = startedAt + pickOpensAfterMs(tour);
  const me = state.players.find((player) => player.id === state.you);
  const spectator = me !== undefined && !isAlive(me);
  const picked = view?.yourPick ?? null;
  const timeUp = now > state.phaseEndsAt;
  const canPick = !spectator && picked === null && !timeUp && now >= opensAt;
  const { clip } = state;

  /** État d'une chanson du tour (index dans la chaîne, et début prévu de son extrait). */
  const songStatus = (index: number, startsAt: number): ReactNode => {
    if (clip?.index === index) {
      return (
        <>
          <span className={styles.status}>
            {t('hl.card.listening', { s: secondsLeft(clip.endsAt, now) })}
          </span>
          <div className={styles.miniTimer}>
            <TimerBar endsAt={clip.endsAt} durationMs={snippetMs} />
          </div>
        </>
      );
    }
    if (now < startsAt) {
      return (
        <span className={styles.statusMuted}>
          {index === 1 && tour === 1 ? t('hl.card.afterA') : t('hl.card.waiting')}
        </span>
      );
    }
    return <span className={styles.statusMuted}>{t('hl.card.listened')}</span>;
  };

  const replayButton = (index: number, startsAt: number, label: string) => (
    <button
      type="button"
      className={styles.replay}
      disabled={now < startsAt || timeUp}
      onClick={() => session.replayClip(index)}
    >
      {label}
    </button>
  );

  const choices: { pick: HigherLowerPick; label: string; icon?: ReactNode }[] =
    tour === 1
      ? [
          { pick: 'lower', label: t('hl.pick.aHigher') },
          { pick: 'higher', label: t('hl.pick.bHigher') },
        ]
      : [
          { pick: 'higher', label: t('hl.pick.higher'), icon: <Chevron up /> },
          { pick: 'lower', label: t('hl.pick.lower'), icon: <Chevron /> },
        ];

  const waitingFor = state.players.filter(
    (player) => isAlive(player) && player.connected && !player.found && player.id !== state.you,
  );

  return (
    <div className={styles.stage}>
      {view ? <span className={styles.window}>{windowLabel(view.window, t, lang)}</span> : null}
      {tour === 1 || !view?.reference ? (
        <>
          <h1 className={styles.question}>{t('hl.question.first')}</h1>
          <p className={styles.note}>{t('hl.popularityNote')}</p>
        </>
      ) : (
        <h1 className={styles.question}>
          {t('hl.question.before')}
          <em>{view.reference.title[lang]}</em>
          {t('hl.question.after')}
        </h1>
      )}

      <div className={styles.duel}>
        {tour === 1 ? (
          <>
            <SongCard letter="A" label="A" playing={clip?.index === 0}>
              {songStatus(0, startedAt)}
              {replayButton(0, startedAt, t('hl.replay.letter', { x: 'A' }))}
            </SongCard>
            <span className={styles.vs}>VS</span>
            <SongCard letter="B" label="B" playing={clip?.index === 1}>
              {songStatus(1, startedAt + snippetMs)}
              {replayButton(1, startedAt + snippetMs, t('hl.replay.letter', { x: 'B' }))}
            </SongCard>
          </>
        ) : (
          <>
            <SongCard
              letter={t('hl.card.reference')}
              label={t('hl.card.reference')}
              card={view?.reference}
              playing={clip?.index === tour - 1}
            >
              {view?.reference ? <Members card={view.reference} /> : null}
              {replayButton(tour - 1, startedAt, t('hl.replay'))}
            </SongCard>
            <span className={styles.vs}>VS</span>
            <SongCard
              letter={t('hl.card.new')}
              label={t('hl.card.new')}
              playing={clip?.index === tour}
            >
              {songStatus(tour, startedAt)}
              {replayButton(tour, startedAt, t('hl.replay'))}
            </SongCard>
          </>
        )}
      </div>

      <div className={styles.timer}>
        <div className={styles.timerLabels}>
          <span>
            {now < snippetsEnd
              ? t(tour === 1 ? 'hl.timer.first' : 'hl.timer.next')
              : t('hl.timer.choose')}
          </span>
          <span>
            {t('game.seconds', {
              s: Math.min(secondsLeft(state.phaseEndsAt, now), listenMs / 1000),
            })}
          </span>
        </div>
        <TimerBar endsAt={state.phaseEndsAt} durationMs={listenMs} />
      </div>

      {spectator ? (
        <p className={styles.hint}>
          {me?.eliminatedAt === 0 ? t('hl.spectator.late') : t('hl.spectator.out')}
        </p>
      ) : (
        <>
          <div className={styles.choices}>
            {choices.map((choice) => (
              <button
                key={choice.pick}
                type="button"
                aria-pressed={picked === choice.pick}
                disabled={!canPick}
                className={[
                  styles.choice,
                  picked === choice.pick ? styles.choiceOn : '',
                  picked !== null && picked !== choice.pick ? styles.choiceOff : '',
                  picked === null && !canPick ? styles.choiceLocked : '',
                ].join(' ')}
                onClick={() => void session.pickHigherLower(choice.pick)}
              >
                {choice.icon}
                {choice.label}
              </button>
            ))}
          </div>
          <p className={picked ? styles.sent : styles.hint} role="status" aria-live="polite">
            {picked
              ? `${t('hl.pick.sent', { pick: pickLabel(tour, picked, t) })} ${
                  waitingFor.length > 0
                    ? t('hl.pick.waiting', {
                        names: waitingFor.map((player) => player.pseudo).join(', '),
                      })
                    : state.players.length > 1
                      ? t('hl.pick.reveal')
                      : ''
                }`
              : timeUp
                ? t('game.timeUp')
                : now < opensAt
                  ? t('hl.pick.opensWithB')
                  : ' '}
          </p>
        </>
      )}
    </div>
  );
}

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

// ─── Révélation ───────────────────────────────────────────────────────────────

interface RevealProps {
  reveal: RoundReveal;
  you: string;
  now: number;
}

/** Révélation (6 s) : jaquettes, membres, écart, choix de chacun, référence suivante. */
export function HigherLowerReveal({ reveal, you, now }: RevealProps) {
  const { t, lang } = useI18n();
  const hl = reveal.higherLower;
  if (!hl) return null;
  const { tour, reference, challenger } = hl;
  const mine = hl.picks.find((entry) => entry.playerId === you);
  const answer = pickLabel(tour, hl.answer, t);
  const challengerMore = hl.answer === 'higher';
  const score = reveal.players.find((player) => player.id === you)?.score ?? 0;
  const multi = reveal.players.length > 1;

  return (
    <div className={styles.stage}>
      <h1
        className={[
          styles.verdict,
          mine ? (mine.correct ? styles.verdictRight : styles.verdictWrong) : '',
        ].join(' ')}
        role="status"
      >
        {mine
          ? t(mine.correct ? 'hl.reveal.right' : 'hl.reveal.wrong', { answer })
          : t('hl.reveal.answer', { answer })}
      </h1>
      {mine?.correct ? (
        <p className={styles.streakLine}>{t('hl.reveal.streak', { n: score })}</p>
      ) : null}
      {hl.allWrong ? <p className={styles.allWrong}>{t('hl.reveal.allWrong')}</p> : null}

      <div className={styles.duel}>
        <SongCard
          letter={tour === 1 ? 'A' : t('hl.card.reference')}
          label={tour === 1 ? 'A' : t('hl.card.reference')}
          card={reference}
          more={!challengerMore}
          winner={!challengerMore}
        >
          <Members card={reference} />
        </SongCard>
        <span className={styles.ratio}>×{formatRatio(hl.ratio, lang)}</span>
        <SongCard
          letter={tour === 1 ? 'B' : t('hl.card.new')}
          label={tour === 1 ? 'B' : t('hl.card.new')}
          card={challenger}
          more={challengerMore}
          winner={challengerMore}
        >
          <Members card={challenger} animate />
        </SongCard>
      </div>

      {multi && hl.picks.length > 0 ? (
        <ul className={styles.picks}>
          {hl.picks.map((entry) => {
            const out = hl.eliminated.includes(entry.playerId);
            const name =
              entry.playerId === you
                ? t('hl.reveal.you')
                : pseudoOf(reveal.players, entry.playerId);
            const choice = entry.pick ? pickShort(tour, entry.pick, t) : t('hl.reveal.noPick');
            return (
              <li
                key={entry.playerId}
                className={[
                  styles.pickItem,
                  entry.correct ? styles.pickRight : styles.pickWrong,
                  out ? styles.pickOut : '',
                ].join(' ')}
              >
                <span
                  className={styles.avatar}
                  style={{ background: avatarColor(entry.playerId) }}
                  aria-hidden="true"
                >
                  {name.charAt(0).toUpperCase()}
                </span>
                {name} ·{' '}
                {entry.correct
                  ? t('hl.reveal.pickRight', { pick: choice })
                  : t('hl.reveal.pickWrong', { pick: choice })}
                {out ? ` · ${t('hl.reveal.out')}` : ''}
              </li>
            );
          })}
        </ul>
      ) : null}

      {hl.gameOver ? (
        <p className={styles.countdown}>
          {t('game.reveal.last', { s: secondsLeft(reveal.phaseEndsAt, now) })}
        </p>
      ) : (
        <>
          <p className={styles.next}>
            {t('hl.reveal.nextRef', { n: tour + 1 })} <strong>{challenger.title[lang]}</strong>{' '}
            {t('hl.reveal.nextRefEnd')}
          </p>
          <p className={styles.countdown}>
            {t('hl.reveal.next', { s: secondsLeft(reveal.phaseEndsAt, now) })}
          </p>
        </>
      )}
    </div>
  );
}

// ─── En-tête : série ──────────────────────────────────────────────────────────

/** « Série 3 » et les couleurs des jaquettes de la série. */
export function StreakPill({ state }: { state: SessionState }) {
  const { t } = useI18n();
  const score = state.players.find((player) => player.id === state.you)?.score ?? 0;
  const colors = state.history
    .filter((reveal) => reveal.results.find((r) => r.playerId === state.you)?.correct)
    .map((reveal) => reveal.higherLower?.challenger.coverColor ?? 'var(--color-lavender)')
    .slice(-5);
  return (
    <span className={styles.streak}>
      {t('hl.streak')} <b>{score}</b>
      {colors.length > 0 ? (
        <span className={styles.chain} aria-hidden="true">
          {colors.map((color, i) => (
            <span key={i} style={{ background: color }} />
          ))}
        </span>
      ) : null}
    </span>
  );
}

// ─── Barre latérale ───────────────────────────────────────────────────────────

/** Joueurs encore en jeu (et ce qu'ils font), éliminés, et la série du joueur. */
export function HigherLowerSidebar({ state, now }: { state: SessionState; now: number }) {
  const { t, lang } = useI18n();
  const { players, you, phase } = state;
  const alive = players.filter(isAlive);
  const out = players.filter((player) => !isAlive(player));
  const me = players.find((player) => player.id === you);
  const tour = state.round;
  const opensAt = state.phaseEndsAt - higherLowerListenMs(tour) + pickOpensAfterMs(tour);

  const stateOf = (player: PlayerScore): { text: string; done?: boolean } => {
    if (!player.connected) return { text: t('room.offline') };
    if (phase !== 'listening') return { text: t('hl.side.streak', { n: player.score }) };
    if (player.found) return { text: t('hl.side.answered'), done: true };
    return { text: now < opensAt ? t('hl.side.listening') : t('hl.side.thinking') };
  };

  const row = (player: PlayerScore, right: { text: string; done?: boolean }, dim = false) => (
    <li
      key={player.id}
      className={[
        sidebar.player,
        player.id === you ? sidebar.me : '',
        player.connected ? '' : sidebar.offline,
        dim ? styles.out : '',
      ].join(' ')}
    >
      <span
        className={sidebar.avatar}
        style={{ background: avatarColor(player.id) }}
        aria-hidden="true"
      >
        {player.pseudo.charAt(0).toUpperCase()}
      </span>
      <span className={sidebar.name}>
        {player.pseudo}
        {player.id === you ? ` ${t('hl.you')}` : ''}
      </span>
      <span className={[styles.state, right.done ? styles.stateDone : ''].join(' ')}>
        {right.text}
      </span>
    </li>
  );

  return (
    <aside className={sidebar.sidebar}>
      {players.length > 1 ? (
        <section className={sidebar.ranking}>
          <h2 className={styles.sideTitle}>{t('hl.side.alive', { n: alive.length })}</h2>
          <ol className={sidebar.players}>{alive.map((player) => row(player, stateOf(player)))}</ol>
          {out.length > 0 ? (
            <>
              <p className={styles.sep}>{t('hl.side.out')}</p>
              <ol className={sidebar.players}>
                {out.map((player) =>
                  row(
                    player,
                    {
                      text: player.eliminatedAt
                        ? t('hl.side.tour', { n: player.eliminatedAt })
                        : t('hl.side.watching'),
                    },
                    true,
                  ),
                )}
              </ol>
              <p className={styles.sideHint}>{t('hl.side.hint')}</p>
            </>
          ) : null}
        </section>
      ) : (
        <div className={sidebar.scoreCard}>
          <span className={sidebar.scoreLabel}>{t('hl.streak')}</span>
          <span className={sidebar.score}>{me?.score ?? 0}</span>
        </div>
      )}

      {state.history.length > 0 ? (
        <section className={sidebar.history}>
          <h2 className={sidebar.historyTitle}>{t('hl.side.series')}</h2>
          <ol className={sidebar.rounds}>
            {[...state.history].reverse().map((reveal) => {
              const mine = reveal.results.find((result) => result.playerId === you);
              const hl = reveal.higherLower;
              if (!hl || !mine) return null;
              return (
                <li key={reveal.round} className={sidebar.round}>
                  <span
                    className={[sidebar.mark, mine.correct ? sidebar.markFound : ''].join(' ')}
                    aria-hidden="true"
                  >
                    {mine.correct ? '✓' : '✗'}
                  </span>
                  <span className={sidebar.roundTitle}>{hl.challenger.title[lang]}</span>
                  <span className={styles.ratioSmall}>×{formatRatio(hl.ratio, lang)}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </aside>
  );
}
