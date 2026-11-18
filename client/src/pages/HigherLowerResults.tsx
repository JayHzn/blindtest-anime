import { isAlive, type HigherLowerReveal, type PlayerScore } from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/ui/Button';
import type { SessionState } from '../game/GameSession';
import { formatMembers, formatRatio, pickLower, pickShort } from '../game/higherLowerFormat';
import { useI18n } from '../i18n/context';
import { avatarColor } from '../lib/avatar';
import type { ResultsActions } from './Results';
import styles from './HigherLowerResults.module.css';

interface Props {
  state: SessionState;
  actions: ResultsActions;
}

/** Fin de partie Plus ou moins, d'après la maquette : série (solo) ou classement (multi). */
export function HigherLowerResults({ state, actions }: Props) {
  const { t } = useI18n();
  const tours = state.history
    .map((reveal) => reveal.higherLower)
    .filter((tour): tour is HigherLowerReveal => tour !== undefined);
  const multi = state.players.length > 1;
  const pill = [
    t('setup.mode.higherLower'),
    actions.kind === 'room' && actions.code
      ? t('hl.results.room', { code: actions.code })
      : t('hl.results.solo'),
    multi
      ? t('hl.results.players', { n: state.players.length })
      : t(`setup.popularity.${state.settings.filters.popularity}`),
  ].join(' · ');

  return (
    <div className={styles.page}>
      <AppHeader center={<span className={styles.pill}>{pill}</span>} />
      {multi ? (
        <Multi state={state} actions={actions} tours={tours} />
      ) : (
        <Solo state={state} actions={actions} tours={tours} />
      )}
    </div>
  );
}

interface ViewProps extends Props {
  tours: HigherLowerReveal[];
}

function Actions({ actions }: { actions: ResultsActions }) {
  const { t } = useI18n();
  return (
    <div className={styles.actions}>
      {actions.kind === 'solo' ? (
        <>
          <Button size="lg" onClick={actions.onReplay}>
            {t('results.replay')}
          </Button>
          <Button size="lg" variant="ghost" onClick={actions.onHome}>
            {t('results.home')}
          </Button>
        </>
      ) : (
        <Button size="lg" onClick={actions.onBackToLobby}>
          {t('results.backToLobby')}
        </Button>
      )}
    </div>
  );
}

// ─── Solo ─────────────────────────────────────────────────────────────────────

function Solo({ state, actions, tours }: ViewProps) {
  const { t, lang } = useI18n();
  const score = state.players.find((player) => player.id === state.you)?.score ?? 0;
  const { previousBest } = state;
  const isRecord = previousBest !== null && score > previousBest;
  const mistake = tours.find(
    (tour) => tour.picks.find((entry) => entry.playerId === state.you)?.correct === false,
  );
  const myPick = mistake?.picks.find((entry) => entry.playerId === state.you)?.pick ?? null;
  const first = tours[0];

  return (
    <div className={styles.wrap}>
      <section className={styles.hero} aria-label={t('results.title')}>
        <p className={styles.over}>{t('hl.results.streakOver')}</p>
        <p className={styles.big}>{score}</p>
        <p className={styles.unit}>
          {t(score === 1 ? 'hl.results.streakUnit.one' : 'hl.results.streakUnit')}
        </p>
        {state.end?.reason === 'audio_unavailable' ? (
          <p className={styles.warning}>{t('results.audioUnavailable')}</p>
        ) : null}
        {isRecord ? <span className={styles.record}>{t('results.record')}</span> : null}
        {previousBest !== null ? (
          <p className={styles.prev}>
            {isRecord
              ? t('hl.results.previousRecord', { n: previousBest })
              : t('results.previousBest', { score: previousBest })}
          </p>
        ) : null}

        {mistake ? (
          <div className={styles.last}>
            <h2>{t('hl.results.mistake', { n: mistake.tour })}</h2>
            <div className={styles.vsrow}>
              <MiniCard card={mistake.reference} win={mistake.answer === 'lower'} lang={lang} />
              <span className={styles.vsx}>×{formatRatio(mistake.ratio, lang)}</span>
              <MiniCard card={mistake.challenger} win={mistake.answer === 'higher'} lang={lang} />
            </div>
            <p className={styles.said}>
              {myPick ? (
                <>
                  {t('hl.results.saidBefore')}{' '}
                  <b>{mistake.tour === 1 ? pickShort(1, myPick, t) : pickLower(myPick, t)}</b>{' '}
                  {t('hl.results.saidAfter', { title: mistake.challenger.title[lang] })}
                </>
              ) : (
                t('hl.results.silent', { title: mistake.challenger.title[lang] })
              )}
            </p>
          </div>
        ) : first && state.end?.reason === 'completed' ? (
          <p className={styles.prev}>{t('hl.results.maxed')}</p>
        ) : null}

        <Actions actions={actions} />
      </section>

      {first ? (
        <section className={styles.chain} aria-label={t('hl.results.series')}>
          <h2>{t('hl.results.series')}</h2>
          <p className={styles.start}>
            {t('hl.results.start', {
              title: first.reference.title[lang],
              n: formatMembers(first.reference.popularity, lang),
            })}
          </p>
          {tours.map((tour) => {
            const mine = tour.picks.find((entry) => entry.playerId === state.you);
            const failed = mine !== undefined && !mine.correct;
            const up = tour.answer === 'higher';
            return (
              <div key={tour.tour} className={[styles.step, failed ? styles.fail : ''].join(' ')}>
                <span className={styles.n}>{tour.tour}</span>
                <span
                  className={styles.dot}
                  style={{ background: tour.challenger.coverColor ?? 'var(--color-lavender)' }}
                />
                <span className={styles.name}>{tour.challenger.title[lang]}</span>
                <span className={styles.num}>
                  {formatMembers(tour.challenger.popularity, lang)}
                </span>
                <span
                  className={[styles.arrow, failed ? styles.ko : up ? styles.up : styles.down].join(
                    ' ',
                  )}
                >
                  {failed
                    ? t('hl.results.missed')
                    : `${t(up ? 'hl.pick.short.higher' : 'hl.pick.short.lower')} · ×${formatRatio(tour.ratio, lang)}`}
                </span>
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function MiniCard({
  card,
  win,
  lang,
}: {
  card: HigherLowerReveal['reference'];
  win: boolean;
  lang: 'fr' | 'en';
}) {
  return (
    <div className={[styles.mini, win ? styles.miniWin : ''].join(' ')}>
      <div
        className={styles.sq}
        style={{ background: card.coverColor ?? 'var(--color-surface-3)' }}
      >
        {card.coverUrl ? <img src={card.coverUrl} alt="" /> : null}
      </div>
      <b>{card.title[lang]}</b>
      <span>{formatMembers(card.popularity, lang)}</span>
    </div>
  );
}

// ─── Multi ────────────────────────────────────────────────────────────────────

function Multi({ state, actions, tours }: ViewProps) {
  const { t, lang } = useI18n();
  const lastTour = tours.at(-1)?.tour ?? 0;
  const alive = state.players.filter(isAlive);
  const winner = alive.length === 1 ? alive[0]! : null;
  const tightest = tours.reduce<HigherLowerReveal | null>(
    (best, tour) => (best === null || tour.ratio < best.ratio ? tour : best),
    null,
  );
  const toursPlayed = (player: PlayerScore) =>
    isAlive(player) ? lastTour : (player.eliminatedAt ?? lastTour);

  return (
    <main className={styles.main}>
      {winner ? (
        <>
          <span
            className={styles.crownBig}
            style={{ background: avatarColor(winner.id) }}
            aria-hidden="true"
          >
            {winner.pseudo.charAt(0).toUpperCase()}
          </span>
          <h1 className={styles.winner}>
            {winner.id === state.you ? (
              t('hl.results.winnerYou')
            ) : (
              <>
                <span>{winner.pseudo}</span> {t('hl.results.wins')}
              </>
            )}
          </h1>
          <p className={styles.sub}>
            {t(lastTour === 1 ? 'hl.results.winnerSub.one' : 'hl.results.winnerSub', {
              n: lastTour,
            })}
          </p>
        </>
      ) : (
        <>
          <h1 className={styles.winner}>
            {alive.length > 1 ? t('hl.results.tie') : t('hl.results.noWinner')}
          </h1>
          {alive.length > 1 ? (
            <p className={styles.sub}>
              {t('hl.results.tieText', {
                names: alive.map((player) => player.pseudo).join(', '),
                n: lastTour,
              })}
            </p>
          ) : null}
        </>
      )}
      {state.end?.reason === 'audio_unavailable' ? (
        <p className={styles.warning}>{t('results.audioUnavailable')}</p>
      ) : null}

      <ol className={styles.board}>
        {state.players.map((player, i) => {
          const played = toursPlayed(player);
          let status: string;
          if (isAlive(player)) status = winner ? t('hl.results.lastIn') : t('hl.results.stillIn');
          else if (player.eliminatedAt === 0) status = t('hl.results.late');
          else status = t('hl.results.outAt', { n: player.eliminatedAt! });
          return (
            <li key={player.id} className={[styles.row, i === 0 ? styles.first : ''].join(' ')}>
              <span className={styles.rank}>{i + 1}</span>
              <span
                className={styles.avatar}
                style={{ background: avatarColor(player.id) }}
                aria-hidden="true"
              >
                {player.pseudo.charAt(0).toUpperCase()}
              </span>
              <span className={styles.who}>
                <b className={player.id === state.you ? styles.you : ''}>
                  {player.pseudo}
                  {player.id === state.you ? ` ${t('hl.you')}` : ''}
                </b>
                <small>{status}</small>
              </span>
              <span className={styles.stat}>
                {player.eliminatedAt === 0 ? (
                  '—'
                ) : (
                  <>
                    {t(player.score <= 1 ? 'hl.results.just.one' : 'hl.results.just', {
                      n: player.score,
                    })}
                    <small>
                      {t(played === 1 ? 'hl.results.outOf.one' : 'hl.results.outOf', {
                        n: played,
                      })}
                    </small>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <div className={styles.facts}>
        {tours
          .filter((tour) => tour.allWrong)
          .map((tour) => (
            <span key={tour.tour} className={styles.fact}>
              {t('hl.results.tourLabel', { n: tour.tour })} <b>{t('hl.results.factAllWrong')}</b>
              {t('hl.results.factAllWrongAfter')}
            </span>
          ))}
        {tightest ? (
          <span className={styles.fact}>
            {t('hl.results.factTightest')} <b>×{formatRatio(tightest.ratio, lang)}</b>{' '}
            {t('hl.results.factTour', { n: tightest.tour })}
          </span>
        ) : null}
      </div>

      <Actions actions={actions} />
    </main>
  );
}
