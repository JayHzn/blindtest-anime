import type { RoundReveal } from '@blindtest/shared';
import styles from './RoundDots.module.css';

interface RoundDotsProps {
  total: number;
  current: number;
  history: RoundReveal[];
  you: string;
}

/** Progression de la partie : une pastille par manche (trouvée, ratée, en cours, à venir). */
export function RoundDots({ total, current, history, you }: RoundDotsProps) {
  return (
    <div className={styles.dots} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => {
        const played = history.find((reveal) => reveal.round === i);
        const found = played?.results.find((result) => result.playerId === you)?.correct;
        const state = played
          ? found
            ? styles.found
            : styles.missed
          : i === current
            ? styles.current
            : '';
        return <span key={i} className={[styles.dot, state].join(' ')} />;
      })}
    </div>
  );
}
