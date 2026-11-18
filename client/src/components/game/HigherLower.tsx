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
import {
  cardMeta,
  formatMembers,
  formatRatio,
  pickLower,
  pickShort,
  windowLabel,
} from '../../game/higherLowerFormat';
import { secondsLeft } from '../../hooks/useServerNow';
import { useI18n } from '../../i18n/context';
import { avatarColor } from '../../lib/avatar';
import { TimerBar } from './TimerBar';
import sidebar from './GameSidebar.module.css';
import styles from './HigherLower.module.css';

/*
 * Mode Plus ou moins, d'après la maquette validée :
 * écoute et choix, révélation, série dans l'en-tête, joueurs encore en jeu.
 */

// ─── Éléments communs ─────────────────────────────────────────────────────────

/** Disque de la maquette : tourne (étiquette rose) pendant l'extrait, estompé sinon. */
function Disc({ playing }: { playing: boolean }) {
  return (
    <svg
      className={[styles.disc, playing ? styles.discPlaying : ''].join(' ')}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="48" fill="#120D19" />
      <circle cx="50" cy="50" r="38" fill="none" stroke="#2A2035" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="30" fill="none" stroke="#2A2035" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="16" fill={playing ? '#FF9EC7' : '#B9A6FF'} />
      <circle cx="50" cy="50" r="3" fill="#120D19" />
      {playing ? (
        <path
          d="M50 6 A44 44 0 0 1 94 50"
          fill="none"
          stroke="#B9A6FF"
          strokeWidth="2"
          strokeLinecap="round"
          opacity=".7"
        />
      ) : null}
    </svg>
  );
}

function Chevron({ up = false, size = 22 }: { up?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

/** Jaquette AniList (sur sa couleur dominante, le temps qu'elle charge). */
function Jacket({ card }: { card: HigherLowerCard }) {
  return card.coverUrl ? (
    <img className={styles.jacket} src={card.coverUrl} alt="" />
  ) : (
    <span className={styles.jacket} />
  );
}

const pseudoOf = (players: PlayerScore[], id: string) =>
  players.find((player) => player.id === id)?.pseudo ?? '?';

// ─── Écoute et choix ──────────────────────────────────────────────────────────

interface StageProps {
  session: GameSession;
  state: SessionState;
  now: number;
}

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

  /** Statut, jauge et réécoute d'une chanson jouée pendant le tour. */
  const listenBlock = (index: number, startsAt: number, replayLabel: string) => {
    const playing = clip?.index === index;
    const heard = now >= startsAt;
    const elapsed = playing ? 1 - Math.max(0, clip.endsAt - now) / snippetMs : heard ? 1 : 0;
    let status: string;
    if (playing) status = t('hl.card.listening', { s: secondsLeft(clip.endsAt, now) });
    else if (!heard) status = tour === 1 && index === 1 ? t('hl.card.afterA') : t('hl.card.soon');
    else status = t('hl.card.listened');
    return (
      <>
        <span className={[styles.status, playing ? styles.statusOn : ''].join(' ')}>{status}</span>
        <div className={styles.mini} aria-hidden="true">
          <span style={{ width: `${Math.round(Math.min(1, elapsed) * 100)}%` }} />
        </div>
        <button
          type="button"
          className={styles.replay}
          disabled={!heard || playing || timeUp}
          onClick={() => session.replayClip(index)}
        >
          {replayLabel}
        </button>
      </>
    );
  };

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
  const multi = state.players.length > 1;

  let line: ReactNode = null;
  if (spectator) {
    line = (
      <p className={styles.hint}>
        {me?.eliminatedAt === 0 ? t('hl.spectator.late') : t('hl.spectator.out')}
      </p>
    );
  } else if (picked) {
    const pick = tour === 1 ? pickShort(1, picked, t) : pickLower(picked, t);
    const after =
      waitingFor.length > 0
        ? t('hl.pick.waiting', { names: waitingFor.map((player) => player.pseudo).join(', ') })
        : multi
          ? t('hl.pick.finalReveal')
          : t('hl.pick.final');
    line = (
      <p className={styles.sent} role="status">
        {t('hl.pick.sent', { pick })} {after}
      </p>
    );
  } else if (timeUp) {
    line = <p className={styles.hint}>{t('game.timeUp')}</p>;
  } else if (now < opensAt) {
    line = <p className={styles.hint}>{t('hl.pick.opensWithB')}</p>;
  }

  const reference = view?.reference ?? null;

  return (
    <div className={styles.stage}>
      {view ? <span className={styles.window}>{windowLabel(view.window, t, lang)}</span> : null}
      {tour === 1 || !reference ? (
        <>
          <h1 className={styles.question}>{t('hl.question.first')}</h1>
          <p className={styles.sub}>{t('hl.popularityNote')}</p>
        </>
      ) : (
        <h1 className={styles.question}>
          {t('hl.question.before')}
          <em>{reference.title[lang]}</em>
          {t('hl.question.after')}
        </h1>
      )}

      <div className={styles.duel}>
        {tour === 1 || !reference ? (
          <>
            <section
              className={[styles.card, clip?.index === 0 ? styles.playing : ''].join(' ')}
              aria-label={t('hl.card.song', { x: 'A' })}
            >
              <div className={[styles.cover, styles.coverLarge].join(' ')}>
                <span className={styles.letterRound}>A</span>
                <Disc playing={clip?.index === 0} />
              </div>
              {listenBlock(0, startedAt, t('hl.replay.letter', { x: 'A' }))}
            </section>
            <span className={styles.vs}>VS</span>
            <section
              className={[styles.card, clip?.index === 1 ? styles.playing : ''].join(' ')}
              aria-label={t('hl.card.song', { x: 'B' })}
            >
              <div className={[styles.cover, styles.coverLarge].join(' ')}>
                <span className={styles.letterRound}>B</span>
                <Disc playing={clip?.index === 1} />
              </div>
              {listenBlock(1, startedAt + snippetMs, t('hl.replay.letter', { x: 'B' }))}
            </section>
          </>
        ) : (
          <>
            <section
              className={[styles.card, clip?.index === tour - 1 ? styles.playing : ''].join(' ')}
              aria-label={t('hl.card.reference')}
            >
              <div
                className={styles.cover}
                style={reference.coverColor ? { background: reference.coverColor } : undefined}
              >
                <span className={styles.letter}>{t('hl.card.reference')}</span>
                <Jacket card={reference} />
              </div>
              <p className={styles.title}>{reference.title[lang]}</p>
              <p className={styles.meta}>{cardMeta(reference)}</p>
              <span className={styles.members}>
                {formatMembers(reference.popularity, lang)} <small>{t('hl.members')}</small>
              </span>
              <button
                type="button"
                className={styles.replay}
                disabled={clip?.index === tour - 1 || timeUp}
                onClick={() => session.replayClip(tour - 1)}
              >
                {t('hl.replay')}
              </button>
            </section>
            <span className={styles.vs}>VS</span>
            <section
              className={[styles.card, clip?.index === tour ? styles.playing : ''].join(' ')}
              aria-label={t('hl.card.new')}
            >
              <div className={styles.cover}>
                <span className={styles.letter}>{t('hl.card.new')}</span>
                <Disc playing={clip?.index === tour} />
              </div>
              <p className={styles.title}>???</p>
              <p className={styles.meta}>{t('hl.card.hidden')}</p>
              {listenBlock(tour, startedAt, t('hl.replay'))}
            </section>
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

      {spectator ? null : (
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
              ].join(' ')}
              onClick={() => void session.pickHigherLower(choice.pick)}
            >
              {choice.icon}
              {choice.label}
            </button>
          ))}
        </div>
      )}
      {line}
    </div>
  );
}

// ─── Révélation ───────────────────────────────────────────────────────────────

interface RevealProps {
  reveal: RoundReveal;
  you: string;
  now: number;
}

export function HigherLowerReveal({ reveal, you, now }: RevealProps) {
  const { t, lang } = useI18n();
  const hl = reveal.higherLower;
  if (!hl) return null;
  const { tour, reference, challenger } = hl;
  const mine = hl.picks.find((entry) => entry.playerId === you);
  const challengerMore = hl.answer === 'higher';
  const answer =
    tour === 1
      ? t(challengerMore ? 'hl.pick.bHigher' : 'hl.pick.aHigher')
      : t(challengerMore ? 'hl.pick.higher' : 'hl.pick.lower');
  const score = reveal.players.find((player) => player.id === you)?.score ?? 0;
  const max = Math.max(reference.popularity, challenger.popularity);

  let title: string;
  let sub: string | null = null;
  let tone = '';
  if (!mine) {
    title = t('hl.reveal.answer', { answer });
  } else if (mine.correct) {
    title = t('hl.reveal.right', { answer });
    sub = t('hl.reveal.streak', { n: score });
    tone = styles.verdictRight ?? '';
  } else {
    title = t('hl.reveal.wrong', { answer });
    tone = styles.verdictWrong ?? '';
    sub = hl.allWrong
      ? t('hl.reveal.allWrong')
      : reveal.players.length > 1
        ? t('hl.reveal.youOut')
        : t('hl.reveal.streakOver', { n: score });
  }

  const side = (card: HigherLowerCard, tag: string, more: boolean) => (
    <section className={[styles.card, more ? styles.win : ''].join(' ')} aria-label={tag}>
      <div
        className={[styles.cover, styles.coverReveal].join(' ')}
        style={card.coverColor ? { background: card.coverColor } : undefined}
      >
        <span className={styles.tag}>{tag}</span>
        {more ? (
          <span className={styles.crown}>
            <Chevron up size={14} />
            {t('hl.reveal.more')}
          </span>
        ) : null}
        <Jacket card={card} />
      </div>
      <p className={styles.title}>{card.title[lang]}</p>
      <p className={styles.meta}>{cardMeta(card)}</p>
      <span className={styles.membersBig}>
        {formatMembers(card.popularity, lang)}
        <small>{t('hl.members')}</small>
      </span>
      <div className={styles.gauge} aria-hidden="true">
        <span
          className={more ? styles.gaugeWin : styles.gaugeLose}
          style={{ width: `${Math.round((card.popularity / max) * 100)}%` }}
        />
      </div>
    </section>
  );

  return (
    <div className={styles.stage}>
      <div className={styles.verdict} role="status">
        <p className={[styles.verdictTitle, tone].join(' ')}>{title}</p>
        {sub ? <p className={styles.verdictSub}>{sub}</p> : null}
      </div>

      <div className={styles.duel}>
        {side(reference, tour === 1 ? 'A' : t('hl.card.reference'), !challengerMore)}
        <span className={styles.ratio}>×{formatRatio(hl.ratio, lang)}</span>
        {side(challenger, tour === 1 ? 'B' : t('hl.card.new'), challengerMore)}
      </div>

      {reveal.players.length > 1 && hl.picks.length > 0 ? (
        <div className={styles.results} aria-label={t('hl.reveal.answers')}>
          {hl.picks.map((entry) => {
            const out = hl.eliminated.includes(entry.playerId);
            const name =
              entry.playerId === you
                ? t('hl.reveal.you')
                : pseudoOf(reveal.players, entry.playerId);
            const choice = entry.pick ? pickShort(tour, entry.pick, t) : t('hl.reveal.noPick');
            const text = entry.correct
              ? t('hl.reveal.pickRight', { pick: choice })
              : out
                ? t('hl.reveal.pickOut', { pick: choice })
                : t('hl.reveal.pickWrong', { pick: choice });
            return (
              <div
                key={entry.playerId}
                className={[styles.res, out ? styles.resBad : ''].join(' ')}
              >
                <span
                  className={styles.avatar}
                  style={{ background: avatarColor(entry.playerId) }}
                  aria-hidden="true"
                >
                  {pseudoOf(reveal.players, entry.playerId).charAt(0).toUpperCase()}
                </span>
                <div>
                  <div
                    className={[styles.rname, entry.playerId === you ? styles.you : ''].join(' ')}
                  >
                    {name}
                  </div>
                  <div className={[styles.rpick, entry.correct ? styles.ok : styles.ko].join(' ')}>
                    {text}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <p className={styles.next}>
        <span className={styles.count}>{secondsLeft(reveal.phaseEndsAt, now)}</span>
        {hl.gameOver ? (
          t('hl.reveal.results')
        ) : (
          <span>
            {t('hl.reveal.nextRef', { n: tour + 1 })} <b>{challenger.title[lang]}</b>{' '}
            {t('hl.reveal.nextRefEnd')}
          </span>
        )}
      </p>
    </div>
  );
}

// ─── En-tête : série ──────────────────────────────────────────────────────────

/** « Série 3 » et la couleur des jaquettes de la série (verte juste après une bonne réponse). */
export function StreakPill({ state }: { state: SessionState }) {
  const { t } = useI18n();
  const score = state.players.find((player) => player.id === state.you)?.score ?? 0;
  const colors = state.history
    .filter((reveal) => reveal.results.find((r) => r.playerId === state.you)?.correct)
    .map((reveal) => reveal.higherLower?.challenger.coverColor ?? '#B9A6FF')
    .slice(-6);
  const justScored =
    state.phase === 'reveal' &&
    state.reveal?.results.find((r) => r.playerId === state.you)?.correct === true;
  return (
    <span className={[styles.streak, colors.length > 0 ? styles.streakChain : ''].join(' ')}>
      {t('hl.streak')} <b className={justScored ? styles.streakUp : ''}>{score}</b>
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

// ─── Joueurs ──────────────────────────────────────────────────────────────────

/** « Encore en jeu » (écoute, réfléchit…, a répondu, série N), puis les éliminés. */
export function HigherLowerSidebar({ state, now }: { state: SessionState; now: number }) {
  const { t } = useI18n();
  const { players, you, phase } = state;
  const alive = players.filter(isAlive);
  const out = players.filter((player) => !isAlive(player));
  const tour = state.round;
  const opensAt = state.phaseEndsAt - higherLowerListenMs(tour) + pickOpensAfterMs(tour);

  const stateOf = (player: PlayerScore): { text: string; done?: boolean } => {
    if (!player.connected) return { text: t('room.offline') };
    if (phase !== 'listening') return { text: t('hl.side.streak', { n: player.score }) };
    if (player.found) return { text: t('hl.side.answered'), done: true };
    return { text: now < opensAt ? t('hl.side.listening') : t('hl.side.thinking') };
  };

  const row = (player: PlayerScore, right: { text: string; done?: boolean }, dim = false) => (
    <div
      key={player.id}
      className={[styles.player, dim || !player.connected ? styles.out : ''].join(' ')}
    >
      <span
        className={styles.pavatar}
        style={{ background: avatarColor(player.id) }}
        aria-hidden="true"
      >
        {player.pseudo.charAt(0).toUpperCase()}
      </span>
      <span className={[styles.pname, player.id === you ? styles.you : ''].join(' ')}>
        {player.pseudo}
        {player.id === you ? ` ${t('hl.you')}` : ''}
      </span>
      <span className={[styles.pstate, right.done ? styles.done : ''].join(' ')}>{right.text}</span>
    </div>
  );

  return (
    <aside className={[sidebar.sidebar, styles.side].join(' ')} aria-label={t('game.players')}>
      <h2 className={styles.sideTitle}>{t('hl.side.alive', { n: alive.length })}</h2>
      {alive.map((player) => row(player, stateOf(player)))}
      {out.length > 0 ? (
        <>
          <p className={styles.sep}>{t('hl.side.out')}</p>
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
          {players.length > 1 ? <p className={styles.sideHint}>{t('hl.side.hint')}</p> : null}
        </>
      ) : null}
    </aside>
  );
}
