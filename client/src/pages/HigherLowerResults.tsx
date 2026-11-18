import { isAlive, type HigherLowerReveal, type PlayerScore } from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { cardMeta, formatMembers, formatRatio, pickLabel } from '../game/higherLowerFormat';
import { Card } from '../components/ui/Card';
import type { SessionState } from '../game/GameSession';
import { useI18n } from '../i18n/context';
import { avatarColor } from '../lib/avatar';
import { ResultActions, type ResultsActions } from './Results';
import styles from './Results.module.css';
import hl from './HigherLowerResults.module.css';

interface Props {
  state: SessionState;
  actions: ResultsActions;
}

const PODIUM = [styles.gold, styles.silver, styles.bronze];

/** Fin de partie Plus ou moins : la série (solo) ou le classement par élimination (multi). */
export function HigherLowerResults({ state, actions }: Props) {
  const tours = state.history
    .map((reveal) => reveal.higherLower)
    .filter((tour): tour is HigherLowerReveal => tour !== undefined);
  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={styles.main}>
        {state.players.length > 1 ? (
          <MultiSummary state={state} actions={actions} tours={tours} />
        ) : (
          <SoloSummary state={state} actions={actions} tours={tours} />
        )}
        <SeriesCard state={state} tours={tours} />
      </main>
    </div>
  );
}

interface SummaryProps extends Props {
  tours: HigherLowerReveal[];
}

/** Solo : longueur de la série, record pour ces réglages, et l'erreur qui l'a arrêtée. */
function SoloSummary({ state, actions, tours }: SummaryProps) {
  const { t, lang } = useI18n();
  const score = state.players.find((player) => player.id === state.you)?.score ?? 0;
  const { previousBest } = state;
  const isRecord = previousBest !== null && score > previousBest;
  const mistake = tours.find(
    (tour) => tour.picks.find((entry) => entry.playerId === state.you)?.correct === false,
  );
  const myPick = mistake?.picks.find((entry) => entry.playerId === state.you)?.pick ?? null;

  return (
    <Card className={styles.summary}>
      <h1 className={styles.title}>{t('hl.results.streakOver')}</h1>
      {state.end?.reason === 'audio_unavailable' ? (
        <p className={styles.warning}>{t('results.audioUnavailable')}</p>
      ) : null}
      <div className={styles.score}>
        <span className={styles.scoreValue}>{score}</span>
        <span className={styles.scoreUnit}>
          {t(score === 1 ? 'hl.results.streakUnit.one' : 'hl.results.streakUnit')}
        </span>
      </div>
      {isRecord ? <span className={styles.record}>{t('results.record')}</span> : null}
      {isRecord ? (
        <p className={styles.best}>{t('hl.results.previousRecord', { n: previousBest })}</p>
      ) : previousBest !== null ? (
        <p className={styles.best}>{t('results.previousBest', { score: previousBest })}</p>
      ) : null}

      {mistake ? (
        <section className={hl.mistake}>
          <h2 className={hl.mistakeTitle}>{t('hl.results.mistake', { n: mistake.tour })}</h2>
          <div className={hl.pair}>
            <span className={hl.pairSide}>
              <strong>{mistake.reference.title[lang]}</strong>
              <span>{formatMembers(mistake.reference.popularity, lang)}</span>
            </span>
            <span className={hl.pairRatio}>×{formatRatio(mistake.ratio, lang)}</span>
            <span className={hl.pairSide}>
              <strong>{mistake.challenger.title[lang]}</strong>
              <span>{formatMembers(mistake.challenger.popularity, lang)}</span>
            </span>
          </div>
          <p className={hl.said}>
            {myPick
              ? t('hl.results.said', {
                  pick: pickLabel(mistake.tour, myPick, t),
                  title: mistake.challenger.title[lang],
                })
              : t('hl.results.silent', { title: mistake.challenger.title[lang] })}
          </p>
        </section>
      ) : tours.length > 0 && state.end?.reason === 'completed' ? (
        <p className={styles.found}>{t('hl.results.maxed')}</p>
      ) : null}

      <ResultActions actions={actions} />
    </Card>
  );
}

/** Multi : gagnant, classement par tour d'élimination, faits marquants. */
function MultiSummary({ state, actions, tours }: SummaryProps) {
  const { t, lang } = useI18n();
  const lastTour = tours.at(-1)?.tour ?? 0;
  const alive = state.players.filter(isAlive);
  const tightest = tours.reduce<HigherLowerReveal | null>(
    (best, tour) => (best === null || tour.ratio < best.ratio ? tour : best),
    null,
  );
  const allWrong = tours.filter((tour) => tour.allWrong);

  let headline: string;
  let subline: string | null = null;
  if (alive.length === 1) {
    const winner = alive[0]!;
    headline =
      winner.id === state.you
        ? t('hl.results.winnerYou')
        : t('hl.results.winner', { name: winner.pseudo });
    subline = t('hl.results.winnerText', { n: lastTour });
  } else if (alive.length > 1) {
    headline = t('hl.results.tie');
    subline = t('hl.results.tieText', {
      names: alive.map((player) => player.pseudo).join(', '),
      n: lastTour,
    });
  } else {
    headline = t('hl.results.noWinner');
  }

  const toursPlayed = (player: PlayerScore) =>
    isAlive(player) ? lastTour : (player.eliminatedAt ?? lastTour);

  return (
    <Card className={styles.summary}>
      <h1 className={styles.title}>{headline}</h1>
      {subline ? <p className={styles.found}>{subline}</p> : null}
      {state.end?.reason === 'audio_unavailable' ? (
        <p className={styles.warning}>{t('results.audioUnavailable')}</p>
      ) : null}

      <ol className={[styles.rounds, hl.ranking].join(' ')}>
        {state.players.map((player, i) => {
          const played = toursPlayed(player);
          return (
            <li
              key={player.id}
              className={[styles.round, player.id === state.you ? styles.mine : ''].join(' ')}
            >
              <span className={[styles.rank, PODIUM[i] ?? ''].join(' ')}>{i + 1}</span>
              <span
                className={hl.avatar}
                style={{ background: avatarColor(player.id) }}
                aria-hidden="true"
              >
                {player.pseudo.charAt(0).toUpperCase()}
              </span>
              <span className={styles.roundInfo}>
                <span className={styles.roundTitle}>{player.pseudo}</span>
                <span className={styles.roundSong}>
                  {isAlive(player)
                    ? t('hl.results.stillIn')
                    : player.eliminatedAt === 0
                      ? t('hl.results.late')
                      : t('hl.results.outAt', { n: player.eliminatedAt! })}
                </span>
              </span>
              <span className={hl.right}>
                {player.eliminatedAt === 0
                  ? '—'
                  : t(player.score === 1 ? 'hl.results.right.one' : 'hl.results.right', {
                      n: player.score,
                      total: played,
                    })}
              </span>
            </li>
          );
        })}
      </ol>

      {allWrong.length > 0 || tightest ? (
        <ul className={hl.facts}>
          {allWrong.map((tour) => (
            <li key={tour.tour}>{t('hl.results.allWrong', { n: tour.tour })}</li>
          ))}
          {tightest ? (
            <li>
              {t('hl.results.tightest', {
                ratio: formatRatio(tightest.ratio, lang),
                n: tightest.tour,
              })}
            </li>
          ) : null}
        </ul>
      ) : null}

      <ResultActions actions={actions} />
    </Card>
  );
}

/** La chaîne jouée : départ, puis chaque nouvelle chanson avec sa popularité et l'écart. */
function SeriesCard({ state, tours }: { state: SessionState; tours: HigherLowerReveal[] }) {
  const { t, lang } = useI18n();
  const first = tours[0];
  if (!first) return null;
  const solo = state.players.length <= 1;
  return (
    <Card className={styles.recap}>
      <h2 className={styles.recapTitle}>{solo ? t('hl.results.series') : t('hl.results.tours')}</h2>
      <p className={hl.start}>
        {t('hl.results.start', {
          title: first.reference.title[lang],
          n: formatMembers(first.reference.popularity, lang),
        })}
      </p>
      <ol className={styles.rounds}>
        {tours.map((tour) => {
          const mine = tour.picks.find((entry) => entry.playerId === state.you);
          const missed = mine ? !mine.correct : false;
          return (
            <li key={tour.tour} className={[styles.round, missed ? hl.missed : ''].join(' ')}>
              <span className={styles.roundNumber}>{tour.tour}</span>
              <span className={styles.roundInfo}>
                <span className={styles.roundTitle}>{tour.challenger.title[lang]}</span>
                <span className={styles.roundSong}>
                  {formatMembers(tour.challenger.popularity, lang)} {t('hl.members')} ·{' '}
                  {cardMeta(tour.challenger)}
                </span>
              </span>
              <span className={[styles.roundPoints, missed ? '' : styles.roundFound].join(' ')}>
                {missed
                  ? t('hl.results.missed')
                  : `${t(tour.answer === 'higher' ? 'hl.pick.short.higher' : 'hl.pick.short.lower')} · ×${formatRatio(tour.ratio, lang)}`}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
