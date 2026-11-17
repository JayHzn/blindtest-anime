import { useLayoutEffect, useRef } from 'react';
import { serverNow } from '../../lib/clock';
import styles from './TimerBar.module.css';

interface TimerBarProps {
  /** Fin de la phase (heure serveur). */
  endsAt: number;
  /** Durée totale de la phase, pour la proportion de départ. */
  durationMs: number;
}

/**
 * Jauge qui se vide jusqu'à `endsAt`. Animée par une transition CSS
 * (une seule mise à jour, pas de rendu React à chaque image).
 */
export function TimerBar({ endsAt, durationMs }: TimerBarProps) {
  const fill = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = fill.current;
    if (!element) return;
    const remaining = Math.max(0, endsAt - serverNow());
    element.style.transition = 'none';
    element.style.transform = `scaleX(${Math.min(1, remaining / durationMs)})`;
    void element.offsetWidth; // applique la position de départ avant d'animer
    element.style.transition = `transform ${remaining}ms linear`;
    element.style.transform = 'scaleX(0)';
  }, [endsAt, durationMs]);

  return (
    <div className={styles.track} aria-hidden="true">
      <div ref={fill} className={styles.fill} />
    </div>
  );
}
