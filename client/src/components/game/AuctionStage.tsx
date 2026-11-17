import {
  AUCTION,
  auctionPenalty,
  auctionPoints,
  type AuctionHint,
  type AuctionTurn,
  type AuctionView,
} from '@blindtest/shared';
import type { GameSession, SessionState } from '../../game/GameSession';
import { secondsLeft } from '../../hooks/useServerNow';
import { useTitleIndex } from '../../hooks/useTitleIndex';
import { useI18n, type I18nValue } from '../../i18n/context';
import { fr, type MessageKey } from '../../i18n/fr';
import { avatarColor } from '../../lib/avatar';
import { Vinyl } from '../Vinyl';
import { AnswerForm } from './AnswerForm';
import { TimerBar } from './TimerBar';
import styles from './AuctionStage.module.css';

/** Sous ce nombre de secondes de réponse, la jauge passe au rouge. */
const DANGER_SECONDS = 3;

interface AuctionStageProps {
  session: GameSession;
  state: SessionState;
  now: number;
}

/** Mode Enchères : annonce secrète, puis la réponse de celui qui a la main, vue par tous. */
export function AuctionStage({ session, state, now }: AuctionStageProps) {
  const { t } = useI18n();
  const { auction } = state;
  if (!auction) {
    return (
      <div className={styles.stage}>
        <Vinyl size={150} spinning={false} />
        <p className={styles.caption}>{t('game.loadingAudio')}</p>
      </div>
    );
  }
  return auction.step === 'bidding' ? (
    <Bidding session={session} state={state} auction={auction} now={now} />
  ) : (
    <Turns session={session} state={state} auction={auction} now={now} />
  );
}

interface StepProps extends AuctionStageProps {
  auction: AuctionView;
}

// ─── Annonce ────────────────────────────────────────────────────────────────

function Bidding({ session, state, auction, now }: StepProps) {
  const { t, lang } = useI18n();
  const participant = auction.participants.includes(state.you);
  const remaining = secondsLeft(auction.biddingEndsAt, now);

  return (
    <div className={styles.stage}>
      <Hint hint={auction.hint} />
      <div className={styles.timer}>
        <div className={styles.timerLabels}>
          <span>{t('auction.bid.question')}</span>
          <span className={styles.seconds}>{t('game.seconds', { s: remaining })}</span>
        </div>
        <TimerBar endsAt={auction.biddingEndsAt} durationMs={AUCTION.biddingMs} />
      </div>

      {participant ? (
        <>
          <div className={styles.bids} role="radiogroup" aria-label={t('auction.bid.label')}>
            {AUCTION.bidsMs.map((ms, bid) => (
              <button
                key={ms}
                type="button"
                role="radio"
                aria-checked={auction.yourBid === bid}
                className={[styles.bid, auction.yourBid === bid ? styles.bidSelected : ''].join(
                  ' ',
                )}
                onClick={() => void session.bid(bid)}
              >
                <span className={styles.bidDuration}>{duration(ms, lang, t)}</span>
                <span className={styles.bidGain}>+{auctionPoints(bid)}</span>
                <span className={styles.bidRisk}>−{auctionPenalty(bid)}</span>
              </button>
            ))}
          </div>
          <p className={styles.sent} aria-live="polite">
            {auction.yourBid !== null ? (
              <>
                {t('auction.bid.yours')}{' '}
                <strong>{duration(AUCTION.bidsMs[auction.yourBid]!, lang, t)}</strong>
              </>
            ) : (
              t('auction.bid.choose')
            )}{' '}
            ·{' '}
            {t('auction.bid.count', {
              n: auction.bidders.length,
              total: auction.participants.length,
            })}
          </p>
          <p className={styles.legend}>{t('auction.bid.rule')}</p>
        </>
      ) : (
        <p className={styles.caption}>{t('auction.bid.spectator')}</p>
      )}
    </div>
  );
}

// ─── Passages successifs ──────────────────────────────────────────────────────

function Turns({ session, state, auction, now }: StepProps) {
  const { t, lang } = useI18n();
  const index = useTitleIndex();
  const pseudo = (id: string) => state.players.find((player) => player.id === id)?.pseudo ?? '?';
  const { snippet, order } = auction;
  const holder = auction.step === 'done' ? undefined : order[auction.turn];
  const isHolder = holder?.playerId === state.you;
  // Proposition fausse (ou silence) du joueur précédent, montrée à tous.
  const previous = auction.step === 'done' ? order.at(-1) : order[auction.turn - 1];
  const showMiss =
    previous &&
    (previous.status === 'wrong' || previous.status === 'silent' || previous.status === 'skipped');

  if (auction.step === 'done') {
    const winner = order.find((turn) => turn.status === 'found');
    return (
      <div className={styles.stage}>
        {showMiss && !winner ? (
          <MissToast turn={previous} name={pseudo(previous.playerId)} />
        ) : null}
        {winner ? (
          <div className={styles.outcome} role="status">
            <span className={styles.outcomePoints}>+{winner.points}</span>
            <span className={styles.outcomeLabel}>
              {winner.playerId === state.you
                ? t('game.correct')
                : t('auction.found', { name: pseudo(winner.playerId) })}
            </span>
          </div>
        ) : (
          <p className={styles.caption}>{t('auction.nobody')}</p>
        )}
      </div>
    );
  }
  if (!holder) return null;

  const penalty = auctionPenalty(holder.bid);
  const snippetEnd = snippet ? snippet.startsAt + snippet.durationMs : 0;
  const beforeSnippet = !snippet || now < snippet.startsAt;
  const answering = auction.step === 'answering';
  const answerSeconds = snippet ? secondsLeft(snippet.answerEndsAt, now) : 0;

  let timerLabel: string;
  if (!snippet) timerLabel = t('auction.loadingAudio', { name: pseudo(holder.playerId) });
  else if (beforeSnippet)
    timerLabel = t('auction.listenIn', { s: secondsLeft(snippet.startsAt, now) });
  else if (now < snippetEnd) timerLabel = t('auction.listen');
  else if (isHolder) timerLabel = t('auction.answer.you');
  else timerLabel = t('auction.answer.other', { name: pseudo(holder.playerId) });

  const timer = (
    <div className={styles.timer}>
      <div className={styles.timerLabels}>
        <span>{timerLabel}</span>
        {answering ? (
          <span className={styles.seconds}>
            {t('game.seconds', {
              s: Math.min(answerSeconds, AUCTION.answerMs / 1000),
            })}
          </span>
        ) : null}
      </div>
      {answering && snippet ? (
        <TimerBar
          endsAt={snippet.answerEndsAt}
          durationMs={AUCTION.answerMs}
          danger={answerSeconds <= DANGER_SECONDS}
        />
      ) : (
        <div className={styles.timerIdle} />
      )}
    </div>
  );

  return (
    <div className={styles.stage}>
      <Hint hint={auction.hint} small />
      {showMiss ? <MissToast turn={previous} name={pseudo(previous.playerId)} /> : null}

      {isHolder ? (
        <>
          <Vinyl size={110} spinning={state.snippetPlaying} />
          <div className={styles.stakes}>
            <span key={holder.playerId} className={styles.penalty}>
              −{penalty}
            </span>
            <span className={styles.stakesIf}>{t('auction.penalty.you')}</span>
            <span className={styles.gain}>
              {t('auction.gain.you', { n: auctionPoints(holder.bid) })}
            </span>
          </div>
          {timer}
          <AnswerForm
            key={`${state.round}:${auction.turn}`}
            index={index}
            disabled={beforeSnippet || state.answer.status === 'pending'}
            wrongCount={0}
            bonuses={false}
            onSubmit={(payload) => void session.submitAnswer(payload)}
          />
          <button
            type="button"
            className={styles.replay}
            disabled={!answering || auction.replaysLeft <= 0 || state.snippetPlaying}
            onClick={() => void session.replayAuction()}
          >
            ↻ {t('auction.replay', { s: duration(AUCTION.bidsMs[holder.bid]!, lang, t) })}
            <em>{t('auction.replaysLeft', { n: auction.replaysLeft })}</em>
          </button>
        </>
      ) : (
        <>
          <div className={styles.holder}>
            <span
              className={styles.holderAvatar}
              style={{ background: avatarColor(holder.playerId) }}
              aria-hidden="true"
            >
              {pseudo(holder.playerId).charAt(0).toUpperCase()}
            </span>
            <h2 className={styles.holderName}>
              <span>{pseudo(holder.playerId)}</span> {t('auction.holder')} ·{' '}
              {duration(AUCTION.bidsMs[holder.bid]!, lang, t)}
            </h2>
            {answering ? (
              <span className={styles.typing}>
                {t('auction.typing')} <i />
                <i />
                <i />
              </span>
            ) : null}
          </div>
          <div className={[styles.stakes, styles.stakesWatch].join(' ')}>
            <span key={holder.playerId} className={styles.penalty}>
              −{penalty}
            </span>
            <span className={styles.stakesIf}>
              {t('auction.penalty.other', { name: pseudo(holder.playerId) })}
            </span>
          </div>
          {timer}
          <TurnOrder auction={auction} you={state.you} pseudo={pseudo} />
          <p className={styles.yourTurn}>{yourSituation(auction, state.you, pseudo, t)}</p>
        </>
      )}
    </div>
  );
}

function MissToast({ turn, name }: { turn: AuctionTurn; name: string }) {
  const { t, lang } = useI18n();
  return (
    <div key={turn.playerId} className={styles.toast} role="status">
      {name} :{' '}
      {turn.status === 'wrong' && turn.guess ? (
        <s>{turn.guess[lang]}</s>
      ) : (
        <span>{t(turn.status === 'skipped' ? 'auction.skipped' : 'auction.silent')}</span>
      )}
      {turn.points < 0 ? <b>−{-turn.points}</b> : null}
    </div>
  );
}

function TurnOrder({
  auction,
  you,
  pseudo,
}: {
  auction: AuctionView;
  you: string;
  pseudo: (id: string) => string;
}) {
  const { t, lang } = useI18n();
  const holder = auction.order[auction.turn];
  return (
    <div className={styles.order}>
      <span className={styles.orderLabel}>{t('auction.order')}</span>
      <ol className={styles.orderList}>
        {auction.order.map((turn, position) => {
          const out =
            turn.status === 'wrong' || turn.status === 'silent' || turn.status === 'skipped';
          let detail: string;
          if (turn.status === 'playing') detail = t('auction.status.playing');
          else if (out) {
            const what =
              turn.status === 'wrong' && turn.guess
                ? turn.guess[lang]
                : t(turn.status === 'skipped' ? 'auction.skipped' : 'auction.silent');
            detail = turn.points < 0 ? `${what} · −${-turn.points}` : what;
          } else if (position === auction.turn + 1 && holder) {
            detail = t('auction.status.next', { name: pseudo(holder.playerId) });
          } else detail = t('auction.status.waiting');
          return (
            <li
              key={turn.playerId}
              className={[
                styles.turn,
                turn.status === 'playing' ? styles.turnNow : '',
                out ? styles.turnOut : '',
              ].join(' ')}
            >
              <span className={styles.turnRank}>{position + 1}</span>
              <span
                className={styles.turnAvatar}
                style={{ background: avatarColor(turn.playerId) }}
                aria-hidden="true"
              >
                {pseudo(turn.playerId).charAt(0).toUpperCase()}
              </span>
              <span className={styles.turnWho}>
                <b>
                  {pseudo(turn.playerId)}
                  {turn.playerId === you ? ` ${t('auction.you')}` : ''}
                </b>
                <small className={out && turn.status === 'wrong' ? styles.turnGuess : ''}>
                  {detail}
                </small>
              </span>
              <span className={styles.turnDuration}>
                {duration(AUCTION.bidsMs[turn.bid]!, lang, t)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Hint({ hint, small = false }: { hint: AuctionHint; small?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={[styles.hint, small ? styles.hintSmall : ''].join(' ')}>
      {small ? null : <span className={styles.hintLabel}>{t('auction.hint')}</span>}
      <div className={styles.chips}>
        <span className={[styles.chip, styles.chipType].join(' ')}>{hint.type}</span>
        {hint.year !== null ? (
          <span className={[styles.chip, styles.chipYear].join(' ')}>{hint.year}</span>
        ) : null}
        {hint.genre ? (
          <span className={[styles.chip, styles.chipGenre].join(' ')}>
            {genreLabel(hint.genre, t)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────

/** « 0,5 s » / « 0.5 s ». */
function duration(ms: number, lang: string, t: I18nValue['t']): string {
  return t('game.seconds', { s: (ms / 1000).toLocaleString(lang) });
}

/** Genre AniList traduit (repli sur le nom AniList s'il est inconnu). */
function genreLabel(genre: string, t: I18nValue['t']): string {
  const key = `genre.${genre}`;
  return key in fr ? t(key as MessageKey) : genre;
}

/** Ce qui attend le joueur dans la manche (spectateur, déjà passé, prochain…). */
function yourSituation(
  auction: AuctionView,
  you: string,
  pseudo: (id: string) => string,
  t: I18nValue['t'],
): string {
  const position = auction.order.findIndex((turn) => turn.playerId === you);
  const mine = auction.order[position];
  if (!mine)
    return auction.participants.includes(you) ? t('auction.you.noBid') : t('auction.bid.spectator');
  if (mine.status !== 'waiting') return t('auction.you.out');
  const holder = auction.order[auction.turn];
  if (position === auction.turn + 1 && holder) {
    return t('auction.you.next', { name: pseudo(holder.playerId) });
  }
  return t('auction.you.waiting', { n: position + 1 });
}
