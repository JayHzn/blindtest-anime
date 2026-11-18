import { useState, type FormEvent, type ReactNode } from 'react';
import {
  IMPOSTOR,
  type ImpostorSong,
  type ImpostorView,
  type ImpostorWordError,
  type PlayerScore,
  type RoundReveal,
} from '@blindtest/shared';
import type { GameSession, SessionState } from '../../game/GameSession';
import { secondsLeft } from '../../hooks/useServerNow';
import { useTitleIndex } from '../../hooks/useTitleIndex';
import { useI18n, type I18nValue } from '../../i18n/context';
import { avatarColor } from '../../lib/avatar';
import { AnswerForm } from './AnswerForm';
import { TimerBar } from './TimerBar';
import sidebar from './GameSidebar.module.css';
import styles from './Impostor.module.css';

/*
 * Mode Imposteur, d'après la maquette validée : écoute, indices, vote (et revote),
 * élimination, devinette de la chanson de l'imposteur, révélation de fin de manche.
 */

type T = I18nValue['t'];

const pseudoOf = (players: PlayerScore[], id: string) =>
  players.find((player) => player.id === id)?.pseudo ?? '?';

function Avatar({
  id,
  players,
  size = 'm',
}: {
  id: string;
  players: PlayerScore[];
  size?: 'm' | 'l' | 'xl';
}) {
  return (
    <span
      className={[
        styles.avatar,
        size === 'l' ? styles.avatarL : '',
        size === 'xl' ? styles.avatarXL : '',
      ].join(' ')}
      style={{ background: avatarColor(id) }}
      aria-hidden="true"
    >
      {pseudoOf(players, id).charAt(0).toUpperCase()}
    </span>
  );
}

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

function songMeta(song: ImpostorSong): string {
  return [
    `${song.type}${song.sequence}`,
    song.song ? `« ${song.song} »` : null,
    song.artists,
    song.year,
  ]
    .filter((part) => part !== null && part !== '')
    .join(' · ');
}

function Jacket({ song }: { song: ImpostorSong }) {
  return (
    <div
      className={styles.jacket}
      style={song.coverColor ? { background: song.coverColor } : undefined}
    >
      {song.coverUrl ? <img src={song.coverUrl} alt="" /> : null}
    </div>
  );
}

/** « Ta chanson » : jaquette, anime, OP/ED, chanson, artiste. */
export function MySong({ song, big = false }: { song: ImpostorSong; big?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <section
      className={[styles.mysong, big ? styles.mysongBig : ''].join(' ')}
      aria-label={t('imp.song.yours')}
    >
      <Jacket song={song} />
      <div>
        <small>{t('imp.song.yours')}</small>
        <b>{song.title[lang]}</b>
        <span>{songMeta(song)}</span>
      </div>
    </section>
  );
}

function Timer({
  label,
  endsAt,
  durationMs,
  now,
}: {
  label: string;
  endsAt: number;
  durationMs: number;
  now: number;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.timer}>
      <div className={styles.timerLabels}>
        <span>{label}</span>
        <span>
          {t('game.seconds', { s: Math.min(secondsLeft(endsAt, now), durationMs / 1000) })}
        </span>
      </div>
      <TimerBar endsAt={endsAt} durationMs={durationMs} />
    </div>
  );
}

/** Mots donnés par chaque joueur, tour par tour. */
function WordsTable({ view, state }: { view: ImpostorView; state: SessionState }) {
  const { t } = useI18n();
  const tours = Array.from({ length: Math.max(1, view.tour) }, (_, i) => i + 1);
  const speaker = view.step === 'words' ? view.order[view.turn] : undefined;
  // Ordre de passage du tour en cours d'abord, puis les éliminés.
  const rows = [...view.order, ...view.participants.filter((id) => !view.order.includes(id))];
  return (
    <div className={styles.words} aria-label={t('imp.words.title')}>
      <div
        className={[styles.wrow, styles.wrowHead].join(' ')}
        style={{ '--tours': tours.length } as never}
      >
        <span />
        <span>{t('imp.words.player')}</span>
        {tours.map((tour) => (
          <span key={tour}>{t('imp.words.tour', { n: tour })}</span>
        ))}
      </div>
      {rows.map((id) => {
        const out = !view.alive.includes(id);
        return (
          <div
            key={id}
            className={[
              styles.wrow,
              out ? styles.wrowOut : '',
              id === speaker ? styles.wrowNow : '',
            ].join(' ')}
            style={{ '--tours': tours.length } as never}
          >
            <Avatar id={id} players={state.players} />
            <span className={[styles.pname, id === state.you ? styles.you : ''].join(' ')}>
              {pseudoOf(state.players, id)}
              {id === state.you ? ` ${t('imp.you')}` : ''}
            </span>
            {tours.map((tour) => {
              const entry = view.words.find((w) => w.playerId === id && w.tour === tour);
              if (tour === view.tour && id === speaker) {
                return (
                  <span key={tour} className={[styles.word, styles.wordTyping].join(' ')}>
                    {t('imp.words.typing')}
                  </span>
                );
              }
              return (
                <span
                  key={tour}
                  className={[styles.word, entry?.word ? '' : styles.wordNone].join(' ')}
                >
                  {entry ? (entry.word ?? '…') : '—'}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const wordError = (reason: ImpostorWordError | 'connection', word: string, t: T): string =>
  ({
    title: t('imp.word.error.title', { word }),
    used: t('imp.word.error.used', { word }),
    invalid: t('imp.word.error.invalid'),
    not_your_turn: t('imp.word.error.turn'),
    connection: t('error.connection'),
  })[reason];

/** Champ « Ton mot » : un seul mot, refusé s'il est dans le titre ou déjà donné. */
function WordForm({ session }: { session: GameSession }) {
  const { t } = useI18n();
  const [word, setWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = word.trim();
    if (!text || pending) return;
    setPending(true);
    const reason = await session.impostorWord(text);
    setPending(false);
    if (reason) setError(wordError(reason, text, t));
  };
  return (
    <>
      <form className={styles.field} onSubmit={(event) => void submit(event)}>
        <label htmlFor="impostor-word" className={sidebar.srOnly}>
          {t('imp.word.label')}
        </label>
        <input
          id="impostor-word"
          className={styles.input}
          value={word}
          maxLength={IMPOSTOR.wordMaxLength}
          autoComplete="off"
          autoFocus
          placeholder={t('imp.word.placeholder')}
          aria-describedby="impostor-word-error"
          onChange={(event) => {
            setWord(event.target.value.replace(/\s/g, ''));
            setError(null);
          }}
        />
        <button type="submit" className={styles.primary} disabled={!word.trim() || pending}>
          {t('game.submit')}
        </button>
      </form>
      <p id="impostor-word-error" className={styles.error} role="alert">
        {error ?? ''}
      </p>
    </>
  );
}

interface StageProps {
  session: GameSession;
  state: SessionState;
  now: number;
}

/** La manche en cours, selon l'étape (écoute, indices, vote, élimination, devinette). */
export function ImpostorStage({ session, state, now }: StageProps) {
  const { t } = useI18n();
  const view = state.impostor;
  if (!view) return null;
  const participant = view.participants.includes(state.you);
  const alive = view.alive.includes(state.you);
  const elimination = view.eliminations.find((e) => e.playerId === state.you);

  let banner: ReactNode = null;
  if (!participant) {
    banner = <div className={styles.banner}>{t('imp.spectator.late')}</div>;
  } else if (!alive && elimination && view.step !== 'elimination') {
    banner = (
      <div className={styles.banner}>
        <Avatar id={state.you} players={state.players} />
        <span>
          {t(elimination.impostor ? 'imp.spectator.outImpostor' : 'imp.spectator.outCivil')}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.stage}>
      {banner}
      {view.step === 'listening' ? <Listening state={state} view={view} now={now} /> : null}
      {view.step === 'words' ? (
        <Words session={session} state={state} view={view} now={now} />
      ) : null}
      {view.step === 'voting' || view.step === 'revote' ? (
        <Voting session={session} state={state} view={view} now={now} />
      ) : null}
      {view.step === 'elimination' ? <Elimination state={state} view={view} /> : null}
      {view.step === 'guessing' ? (
        <Guessing session={session} state={state} view={view} now={now} />
      ) : null}
      {view.song && view.step !== 'listening' ? (
        <button
          type="button"
          className={styles.soft}
          disabled={state.snippetPlaying}
          onClick={() => session.replayOwnSong()}
        >
          {t('imp.replay')}
        </button>
      ) : null}
    </div>
  );
}

interface StepProps {
  state: SessionState;
  view: ImpostorView;
  now: number;
}

function Listening({ state, view, now }: StepProps) {
  const { t } = useI18n();
  return (
    <>
      <span className={styles.kicker}>
        {t(view.impostorCount > 1 ? 'imp.count.many' : 'imp.count.one', {
          players: view.participants.length,
          n: view.impostorCount,
        })}
      </span>
      <h1 className={styles.question}>
        {t('imp.listen.before')} <em>{t('imp.listen.em')}</em> {t('imp.listen.after')}
      </h1>
      <p className={styles.sub}>{t('imp.listen.sub')}</p>
      <Disc playing={state.snippetPlaying} />
      {view.song ? <MySong song={view.song} big /> : null}
      <Timer
        label={t('imp.listen.timer')}
        endsAt={view.stepEndsAt}
        durationMs={IMPOSTOR.listenMs}
        now={now}
      />
      <p className={styles.hint}>{t('imp.listen.next')}</p>
    </>
  );
}

function Words({ session, state, view, now }: StepProps & { session: GameSession }) {
  const { t } = useI18n();
  const speaker = view.order[view.turn]!;
  const mine = speaker === state.you;
  return (
    <>
      <h1 className={styles.question}>
        {mine ? (
          <>
            {t('imp.words.you')} <em>{t('imp.words.oneWord')}</em> {t('imp.words.onSong')}
          </>
        ) : (
          t('imp.words.other', { name: pseudoOf(state.players, speaker) })
        )}
      </h1>
      <WordsTable view={view} state={state} />
      {mine ? <WordForm key={`${view.tour}`} session={session} /> : null}
      <Timer
        label={
          mine
            ? t('imp.words.timerYou')
            : t('imp.words.timerOther', { name: pseudoOf(state.players, speaker) })
        }
        endsAt={view.stepEndsAt}
        durationMs={IMPOSTOR.wordMs}
        now={now}
      />
      <p className={styles.hint}>{t('imp.words.rule')}</p>
    </>
  );
}

function Voting({ session, state, view, now }: StepProps & { session: GameSession }) {
  const { t } = useI18n();
  const revote = view.step === 'revote';
  const canVote =
    view.alive.includes(state.you) && !(revote && view.candidates.includes(state.you));
  const targets = revote ? view.candidates : view.alive;
  const wordsOf = (id: string) =>
    view.words
      .filter((w) => w.playerId === id)
      .map((w) => w.word ?? '…')
      .join(' · ');
  const eligible = view.alive.filter((id) => !(revote && view.candidates.includes(id)));
  const durationMs = revote ? IMPOSTOR.revoteMs : (state.settings.voteMs ?? IMPOSTOR.voteDefaultMs);

  return (
    <>
      {revote ? (
        <>
          <span className={styles.kicker}>{t('imp.revote.kicker')}</span>
          <h1 className={styles.question}>
            {t('imp.revote.title')}{' '}
            {view.candidates.map((id, i) => (
              <span key={id}>
                {i > 0 ? ` ${t('imp.and')} ` : ''}
                <em>{pseudoOf(state.players, id)}</em>
              </span>
            ))}
          </h1>
          <p className={styles.sub}>{t('imp.revote.sub')}</p>
        </>
      ) : (
        <>
          <h1 className={styles.question}>
            {t('imp.vote.before')} <em>{t('imp.vote.em')}</em> {t('imp.vote.after')}
          </h1>
          <p className={styles.sub}>{t('imp.vote.sub')}</p>
        </>
      )}
      <div className={styles.ballots}>
        {targets.map((id) => {
          const me = id === state.you;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={view.yourVote === id}
              disabled={!canVote || me}
              className={[styles.ballot, view.yourVote === id ? styles.ballotOn : ''].join(' ')}
              onClick={() => void session.impostorVote(id)}
            >
              <Avatar id={id} players={state.players} size="l" />
              <span className={styles.bw}>
                <b>{me ? t('imp.you.short') : pseudoOf(state.players, id)}</b>
                <span>{wordsOf(id) || '—'}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className={view.yourVote ? styles.ok : styles.hint} role="status">
        {!canVote
          ? t(revote && view.alive.includes(state.you) ? 'imp.vote.tied' : 'imp.vote.watch')
          : view.yourVote
            ? t('imp.vote.yours', { name: pseudoOf(state.players, view.yourVote) })
            : t('imp.vote.choose')}
      </p>
      <Timer
        label={t(view.voters.length > 1 ? 'imp.vote.count' : 'imp.vote.countOne', {
          n: view.voters.length,
          total: eligible.length,
        })}
        endsAt={view.stepEndsAt}
        durationMs={durationMs}
        now={now}
      />
    </>
  );
}

function Elimination({ state, view }: { state: SessionState; view: ImpostorView }) {
  const { t } = useI18n();
  const out = view.lastEliminated;
  const elimination = view.eliminations.find((e) => e.playerId === out && e.tour === view.tour);
  const max = Math.max(1, ...view.tally.map((entry) => entry.votes));
  const impostorsLeft =
    view.impostorCount - view.eliminations.filter((entry) => entry.impostor).length;
  return (
    <>
      {out && elimination ? (
        <>
          <Avatar id={out} players={state.players} size="xl" />
          <p className={styles.big}>
            {out === state.you
              ? t('imp.out.you')
              : t('imp.out.title', { name: pseudoOf(state.players, out) })}
          </p>
          <span
            className={[
              styles.chip,
              styles.chipLarge,
              elimination.impostor ? styles.chipImpostor : styles.chipCivil,
            ].join(' ')}
          >
            {t(elimination.impostor ? 'imp.out.wasImpostor' : 'imp.out.wasCivil')}
          </span>
        </>
      ) : (
        <>
          <p className={styles.big}>{t('imp.out.nobody')}</p>
          <span className={[styles.chip, styles.chipLarge, styles.chipMuted].join(' ')}>
            {t('imp.out.tie')}
          </span>
        </>
      )}
      <p className={styles.sub}>
        {impostorsLeft === 0
          ? t('imp.out.allFound')
          : t(impostorsLeft > 1 ? 'imp.out.leftMany' : 'imp.out.leftOne', { n: impostorsLeft })}
      </p>
      {view.tally.length > 0 ? (
        <div className={styles.tally} aria-label={t('imp.out.tally')}>
          {view.tally
            .filter((entry) => entry.votes > 0)
            .map((entry, i) => (
              <div key={entry.playerId} className={styles.t}>
                <Avatar id={entry.playerId} players={state.players} />
                <div className={styles.tb}>
                  <span
                    className={i === 0 && out ? styles.tbTop : ''}
                    style={{ width: `${Math.round((entry.votes / max) * 100)}%` }}
                  />
                </div>
                <b>{t(entry.votes > 1 ? 'imp.out.votes' : 'imp.out.vote', { n: entry.votes })}</b>
              </div>
            ))}
        </div>
      ) : null}
      <p className={styles.hint}>{t('imp.out.secret')}</p>
    </>
  );
}

function Guessing({ session, state, view, now }: StepProps & { session: GameSession }) {
  const { t } = useI18n();
  const index = useTitleIndex();
  const impostors = view.eliminations.filter((e) => e.impostor).map((e) => e.playerId);
  const names = impostors.map((id) => pseudoOf(state.players, id));
  const clues = view.words.filter((w) => impostors.includes(w.playerId) && w.word);
  const canGuess =
    view.alive.includes(state.you) && !impostors.includes(state.you) && view.yourGuess === null;
  const { answer } = state;
  return (
    <>
      {impostors.length === 1 ? (
        <Avatar id={impostors[0]!} players={state.players} size="xl" />
      ) : null}
      <p className={[styles.big, styles.win].join(' ')}>
        {impostors.length === 1 && impostors[0] === state.you
          ? t('imp.guess.titleYou')
          : t(impostors.length > 1 ? 'imp.guess.titleMany' : 'imp.guess.title', {
              names: names.join(` ${t('imp.and')} `),
            })}
      </p>
      <p className={styles.sub}>{t('imp.guess.sub', { n: IMPOSTOR.civilWinPoints })}</p>
      {clues.length > 0 ? (
        <div className={styles.clues} aria-label={t('imp.guess.clues')}>
          {clues.map((clue) => (
            <span
              key={`${clue.playerId}-${clue.tour}`}
              className={[styles.chip, styles.chipImpostor].join(' ')}
            >
              {clue.word}
            </span>
          ))}
        </div>
      ) : null}
      {canGuess && answer.status !== 'correct' && answer.status !== 'eliminated' ? (
        <div className={styles.answer}>
          <AnswerForm
            key={state.round}
            index={index}
            disabled={answer.status === 'pending'}
            wrongCount={answer.wrongCount}
            bonuses={false}
            onSubmit={(payload) => void session.submitAnswer(payload)}
          />
        </div>
      ) : (
        <p
          className={view.yourGuess || answer.status === 'correct' ? styles.ok : styles.hint}
          role="status"
        >
          {view.yourGuess === true || answer.status === 'correct'
            ? t('imp.guess.right', { n: IMPOSTOR.guessPoints })
            : view.yourGuess === false || answer.status === 'eliminated'
              ? t('imp.guess.wrong')
              : t('imp.guess.watch')}
        </p>
      )}
      <Timer
        label={t('imp.guess.timer', { n: IMPOSTOR.guessPoints })}
        endsAt={view.stepEndsAt}
        durationMs={IMPOSTOR.guessMs}
        now={now}
      />
    </>
  );
}

// ─── En-tête ──────────────────────────────────────────────────────────────────

/** Étape de la manche, à côté du numéro de manche. */
export function ImpostorStepPill({ state }: { state: SessionState }) {
  const { t } = useI18n();
  const view = state.impostor;
  let label: string | null = null;
  if (state.phase === 'reveal') label = t('imp.step.reveal');
  else if (view) {
    label = {
      listening: t('imp.step.listening'),
      words: t('imp.step.words', { n: view.tour }),
      voting: t('imp.step.voting', { n: view.tour }),
      revote: t('imp.step.revote', { n: view.tour }),
      elimination: t('imp.step.elimination', { n: view.tour }),
      guessing: t('imp.step.guessing'),
      done: t('imp.step.reveal'),
    }[view.step];
  }
  return label ? <span className={styles.stepPill}>{label}</span> : null;
}

// ─── Barre latérale ───────────────────────────────────────────────────────────

/** Ta chanson, les joueurs en jeu (et ce qu'ils font), les éliminés ; le classement à la révélation. */
export function ImpostorSidebar({ state }: { state: SessionState }) {
  const { t } = useI18n();
  const view = state.impostor;
  const { players, you } = state;

  const row = (id: string, text: string, tone: '' | 'done' | 'you' = '', dim = false) => {
    const player = players.find((p) => p.id === id);
    return (
      <div
        key={id}
        className={[styles.player, dim || player?.connected === false ? styles.out : ''].join(' ')}
      >
        <Avatar id={id} players={players} />
        <span className={[styles.pname, id === you ? styles.you : ''].join(' ')}>
          {pseudoOf(players, id)}
          {id === you ? ` ${t('imp.you')}` : ''}
        </span>
        <span
          className={[
            styles.pstate,
            tone === 'done' ? styles.done : tone === 'you' ? styles.you : '',
          ].join(' ')}
        >
          {text}
        </span>
      </div>
    );
  };

  // Révélation, compte à rebours : le classement.
  if (!view || state.phase === 'reveal' || state.phase === 'countdown') {
    return (
      <aside className={[sidebar.sidebar, styles.side].join(' ')} aria-label={t('game.players')}>
        <h2 className={styles.sideTitle}>{t('imp.side.ranking')}</h2>
        {players.map((player) => row(player.id, String(player.score)))}
      </aside>
    );
  }

  const stateOf = (id: string): [string, '' | 'done' | 'you'] => {
    const player = players.find((p) => p.id === id);
    if (player && !player.connected) return [t('room.offline'), ''];
    switch (view.step) {
      case 'listening':
        return [t('imp.side.listening'), ''];
      case 'words': {
        if (view.order[view.turn] === id) return [t('imp.words.typing'), 'you'];
        const word = view.words.find((w) => w.playerId === id && w.tour === view.tour);
        return word ? [word.word ?? '…', 'done'] : [t('imp.side.waiting'), ''];
      }
      case 'voting':
      case 'revote':
        if (view.step === 'revote' && view.candidates.includes(id))
          return [t('imp.side.noVote'), ''];
        return view.voters.includes(id)
          ? [t('imp.side.voted'), 'done']
          : [t('imp.side.voting'), ''];
      case 'guessing':
        if (view.eliminations.some((e) => e.playerId === id && e.impostor)) return ['', ''];
        return view.guessers.includes(id)
          ? [t('imp.side.answered'), 'done']
          : [t('imp.side.guessing'), ''];
      default:
        return ['', ''];
    }
  };

  const spectators = players.filter((p) => !view.participants.includes(p.id));
  const hint =
    view.step === 'words'
      ? t('imp.side.hint.words')
      : view.step === 'voting' || view.step === 'revote'
        ? t('imp.side.hint.vote')
        : view.step === 'elimination'
          ? t(
              view.impostorCount - view.eliminations.filter((e) => e.impostor).length > 1
                ? 'imp.out.leftMany'
                : 'imp.out.leftOne',
              { n: view.impostorCount - view.eliminations.filter((e) => e.impostor).length },
            )
          : null;

  return (
    <aside className={[sidebar.sidebar, styles.side].join(' ')} aria-label={t('game.players')}>
      {view.song ? <MySong song={view.song} /> : null}
      <h2 className={styles.sideTitle}>{t('imp.side.alive', { n: view.alive.length })}</h2>
      {view.alive.map((id) => {
        const [text, tone] = stateOf(id);
        return row(id, text, tone);
      })}
      {view.eliminations.length > 0 || spectators.length > 0 ? (
        <>
          <p className={styles.sep}>{t('imp.side.out')}</p>
          {view.eliminations.map((e) =>
            row(
              e.playerId,
              t(e.impostor ? 'imp.side.outImpostor' : 'imp.side.outCivil', { n: e.tour }),
              '',
              true,
            ),
          )}
          {spectators.map((p) => row(p.id, t('imp.side.watching'), '', true))}
        </>
      ) : null}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </aside>
  );
}

// ─── Révélation de fin de manche ──────────────────────────────────────────────

export function ImpostorReveal({
  session,
  reveal,
  state,
  now,
}: {
  session: GameSession;
  reveal: RoundReveal;
  state: SessionState;
  now: number;
}) {
  const { t, lang } = useI18n();
  const imp = reveal.impostor;
  if (!imp) return null;
  const impostors = imp.players.filter((p) => p.impostor);
  const names = impostors
    .map((p) => pseudoOf(reveal.players, p.playerId))
    .join(` ${t('imp.and')} `);
  const civilsWon = imp.winner === 'civils';
  const caught = impostors.find((p) => p.eliminatedAt !== null);
  const isLast = reveal.round + 1 >= state.totalRounds;

  const song = (which: 'civil' | 'impostor') => {
    const data = which === 'civil' ? imp.civilSong : imp.impostorSong;
    return (
      <section
        className={[styles.song, which === 'impostor' ? styles.songImpostor : ''].join(' ')}
        aria-label={t(which === 'civil' ? 'imp.reveal.civilSong' : 'imp.reveal.impostorSong')}
      >
        <Jacket song={data} />
        <div>
          <p className={styles.songTag}>
            {t(which === 'civil' ? 'imp.reveal.civilSong' : 'imp.reveal.impostorSong')}
          </p>
          <h3>{data.title[lang]}</h3>
          <p>{songMeta(data)}</p>
          <button
            type="button"
            className={[styles.soft, styles.small].join(' ')}
            onClick={() => session.playRevealSong(which)}
          >
            {t('imp.replay.short')}
          </button>
        </div>
      </section>
    );
  };

  const note = (p: (typeof imp.players)[number]): string => {
    if (p.impostor) {
      return p.eliminatedAt !== null
        ? t('imp.reveal.caught', { n: p.eliminatedAt })
        : t('imp.reveal.neverCaught');
    }
    if (p.guessed === true) return t('imp.reveal.guessRight');
    if (p.guessed === false) return t('imp.reveal.guessWrong');
    return p.eliminatedAt !== null ? t('imp.reveal.outAt', { n: p.eliminatedAt }) : '';
  };

  return (
    <div className={styles.stage}>
      {!civilsWon && impostors.length === 1 ? (
        <Avatar id={impostors[0]!.playerId} players={reveal.players} size="xl" />
      ) : null}
      <p className={[styles.verdict, civilsWon ? '' : styles.verdictImpostor].join(' ')}>
        {civilsWon
          ? t('imp.reveal.civils')
          : t(impostors.length > 1 ? 'imp.reveal.impostorsMany' : 'imp.reveal.impostors', {
              names,
            })}
      </p>
      <p className={styles.sub}>
        {civilsWon
          ? t(impostors.length > 1 ? 'imp.reveal.civilsSubMany' : 'imp.reveal.civilsSub', {
              names,
              n: caught?.eliminatedAt ?? 1,
            })
          : t('imp.reveal.impostorsSub', { n: IMPOSTOR.impostorWinPoints })}
      </p>
      <div className={styles.songs}>
        {song('civil')}
        {song('impostor')}
      </div>
      <div className={styles.recap} aria-label={t('imp.reveal.recap')}>
        {imp.players.map((p) => {
          const words = imp.words
            .filter((w) => w.playerId === p.playerId)
            .map((w) => w.word ?? '…')
            .join(' · ');
          const extra = note(p);
          return (
            <div
              key={p.playerId}
              className={[styles.r, p.impostor ? styles.rImpostor : ''].join(' ')}
            >
              <Avatar id={p.playerId} players={reveal.players} />
              <span
                className={[styles.pname, p.playerId === state.you ? styles.you : ''].join(' ')}
              >
                {pseudoOf(reveal.players, p.playerId)}
                {p.playerId === state.you ? ` ${t('imp.you')}` : ''}
              </span>
              <span
                className={[styles.chip, p.impostor ? styles.chipImpostor : styles.chipCivil].join(
                  ' ',
                )}
              >
                {t(p.impostor ? 'imp.role.impostor' : 'imp.role.civil')}
              </span>
              <span className={styles.rw}>
                {words || '—'}
                {extra ? ` · ${extra}` : ''}
              </span>
              <span className={[styles.pts, p.points > 0 ? styles.ok : ''].join(' ')}>
                +{p.points}
              </span>
            </div>
          );
        })}
      </div>
      <p className={styles.next}>
        <span className={[styles.chip, styles.chipMuted].join(' ')}>
          {secondsLeft(reveal.phaseEndsAt, now)}
        </span>
        {isLast ? t('imp.reveal.results') : t('imp.reveal.next', { n: reveal.round + 2 })}
      </p>
    </div>
  );
}
