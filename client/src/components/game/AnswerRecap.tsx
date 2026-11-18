import {
  BONUS_POINTS,
  PROGRESSIVE,
  type PlayerRoundResult,
  type RoundReveal,
} from '@blindtest/shared';
import { useI18n } from '../../i18n/context';
import styles from './AnswerRecap.module.css';

interface AnswerRecapProps {
  reveal: RoundReveal;
  result: PlayerRoundResult;
}

/** « L'Attaque des Titans — Saison 3 » sans le nom de la série : « Saison 3 ». */
function withoutSeries(title: string, series: string): string | null {
  if (title.length <= series.length || !title.toLowerCase().startsWith(series.toLowerCase())) {
    return null;
  }
  return title.slice(series.length).replace(/^[\s—–:\-·]+/, '') || null;
}

/**
 * Révélation : ta réponse face à la bonne (ce qui est juste en menthe, ce qui
 * diffère en rose), puis le détail des points : rapidité (ou palier) et bonus
 * de précision, gagnés ou manqués (avec la bonne valeur).
 */
export function AnswerRecap({ reveal, result }: AnswerRecapProps) {
  const { t, lang } = useI18n();
  const bonuses = reveal.bonuses ?? { season: false, sequence: false };
  const { answer, correct } = result;
  const rightTitle = reveal.anime.title[lang];
  const series = reveal.franchise.title[lang];
  const { type, sequence } = reveal.theme;
  const rightNumber = `${type} ${sequence}`;
  const seasonOk = !bonuses.season || result.seasonExact;
  const attempts = result.attempts ?? 0;

  // Titre du joueur : en entier juste, en entier faux, ou série juste + saison fausse.
  const renderTitle = () => {
    if (!answer) return null;
    const title = answer.title[lang];
    if (!correct) return <span className={styles.ko}>{title}</span>;
    if (seasonOk) return <span className={styles.ok}>{title}</span>;
    if (answer.kind === 'franchise') {
      return (
        <>
          <span className={styles.ok}>{title}</span>{' '}
          <span className={styles.ko}>{t('game.reveal.series')}</span>
        </>
      );
    }
    const rest = withoutSeries(title, series);
    if (rest === null) return <span className={styles.ko}>{title}</span>;
    return (
      <>
        <span className={styles.ok}>{title.slice(0, title.length - rest.length).trimEnd()}</span>{' '}
        <span className={styles.ko}>{rest}</span>
      </>
    );
  };

  const playlistBonus = (result.playlist?.foundBonus ?? 0) + (result.playlist?.guessBonus ?? 0);
  const basePoints =
    result.points -
    (result.seasonExact ? BONUS_POINTS : 0) -
    (result.sequenceExact ? BONUS_POINTS : 0) -
    playlistBonus;
  const seconds = (ms: number) =>
    t('game.seconds', { s: (ms / 1000).toLocaleString(lang, { maximumFractionDigits: 1 }) });

  let missedText = t('game.reveal.missedNone');
  if (attempts === 1) missedText = t('game.reveal.missedOne');
  else if (attempts > 1) missedText = t('game.reveal.missedMany', { n: attempts });

  return (
    <div className={styles.recap}>
      {answer ? (
        <dl className={styles.compare}>
          <dt className={styles.label}>
            {correct ? t('game.reveal.yourAnswer') : t('game.reveal.lastGuess')}
          </dt>
          <dd className={styles.value}>
            {renderTitle()}
            {answer.sequence !== null ? (
              <>
                <span className={styles.dot}> · </span>
                <span className={correct && answer.sequence === sequence ? styles.ok : styles.ko}>
                  {type} {answer.sequence}
                </span>
              </>
            ) : null}
          </dd>
          <dt className={styles.label}>{t('game.reveal.rightAnswer')}</dt>
          <dd className={styles.value}>
            {rightTitle}
            <span className={styles.dot}> · </span>
            {rightNumber}
          </dd>
        </dl>
      ) : null}

      <div className={styles.chips}>
        {correct ? (
          <>
            <span className={[styles.chip, styles.win].join(' ')}>
              {result.tier !== null
                ? t('game.reveal.tierPoints', {
                    n: basePoints,
                    s: seconds(PROGRESSIVE.tiersMs[result.tier] ?? 0),
                  })
                : t('game.reveal.speed', { n: basePoints })}
              {result.tier === null && result.elapsedMs !== null ? (
                <small className={styles.detail}>{seconds(result.elapsedMs)}</small>
              ) : null}
            </span>
            {bonuses.season ? (
              <BonusChip
                won={result.seasonExact}
                label={t('game.reveal.bonusSeason')}
                was={withoutSeries(rightTitle, series) ?? rightTitle}
              />
            ) : null}
            {bonuses.sequence ? (
              <BonusChip
                won={result.sequenceExact}
                label={t('game.reveal.bonusSequence')}
                was={rightNumber}
              />
            ) : null}
            <span className={styles.total}>+{result.points}</span>
          </>
        ) : (
          <>
            <span className={[styles.chip, styles.lost].join(' ')}>{missedText}</span>
            <span className={[styles.total, styles.zero].join(' ')}>0</span>
          </>
        )}
      </div>
    </div>
  );
}

function BonusChip({ won, label, was }: { won: boolean; label: string; was: string }) {
  const { t } = useI18n();
  if (won) {
    return (
      <span className={[styles.chip, styles.win].join(' ')}>
        +{BONUS_POINTS} {label}
      </span>
    );
  }
  return (
    <span className={[styles.chip, styles.miss].join(' ')}>
      <s className={styles.struck}>+{BONUS_POINTS}</s> {label}
      <small className={styles.detail}>{t('game.reveal.was', { x: was })}</small>
    </span>
  );
}
