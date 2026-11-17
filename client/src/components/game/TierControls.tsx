import { PROGRESSIVE, PROGRESSIVE_LAST_TIER, type TierProgress } from '@blindtest/shared';
import { useI18n } from '../../i18n/context';
import styles from './TierControls.module.css';

interface TierControlsProps {
  progress: TierProgress;
  playing: boolean;
  disabled: boolean;
  onReplay: () => void;
  onNext: () => void;
  /** Dernier palier : le joueur ne sait pas et passe la manche. */
  onGiveUp: () => void;
}

/** Mode Progressif : paliers (durée + points), réécoute, palier suivant (ou abandon), essais restants. */
export function TierControls({
  progress,
  playing,
  disabled,
  onReplay,
  onNext,
  onGiveUp,
}: TierControlsProps) {
  const { t, lang } = useI18n();
  const seconds = (ms: number) => t('game.seconds', { s: (ms / 1000).toLocaleString(lang) });
  const currentMs = PROGRESSIVE.tiersMs[progress.tier] ?? 0;
  const isLast = progress.tier >= PROGRESSIVE_LAST_TIER;

  return (
    <div className={styles.wrap}>
      <ol className={styles.tiers} aria-label={t('progressive.tiers')}>
        {PROGRESSIVE.tiersMs.map((ms, i) => (
          <li
            key={ms}
            className={[
              styles.tier,
              i < progress.tier ? styles.past : '',
              i === progress.tier ? styles.current : '',
            ].join(' ')}
            aria-current={i === progress.tier ? 'step' : undefined}
          >
            <span className={styles.length}>{seconds(ms)}</span>
            <span className={styles.points}>
              {t('progressive.points', { n: PROGRESSIVE.tierPoints[i] ?? 0 })}
            </span>
          </li>
        ))}
      </ol>

      <div className={styles.controls}>
        <button type="button" className={styles.action} onClick={onReplay} disabled={disabled}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            className={playing ? styles.pulse : undefined}
          >
            <path d="M7 4.5v15l13-7.5z" />
          </svg>
          {t('progressive.replay', { s: seconds(currentMs) })}
        </button>

        <div className={styles.attempts}>
          <span>{t('progressive.attempts')}</span>
          <span
            className={styles.dots}
            aria-label={t('progressive.attemptsLeft', { n: progress.attemptsLeft })}
          >
            {Array.from({ length: PROGRESSIVE.attemptsPerTier }, (_, i) => (
              <span
                key={i}
                className={[styles.dot, i < progress.attemptsLeft ? styles.dotLeft : ''].join(' ')}
              />
            ))}
          </span>
        </div>

        {isLast ? (
          // Plus d'extrait à débloquer : le joueur qui ne sait pas passe la manche.
          <button
            type="button"
            className={[styles.action, styles.giveUp].join(' ')}
            onClick={onGiveUp}
            disabled={disabled}
          >
            {t('progressive.giveUp')}
          </button>
        ) : (
          <button type="button" className={styles.action} onClick={onNext} disabled={disabled}>
            {t('progressive.next')}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
