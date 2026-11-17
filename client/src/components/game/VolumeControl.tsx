import { useId } from 'react';
import { useI18n } from '../../i18n/context';
import styles from './VolumeControl.module.css';

interface VolumeControlProps {
  volume: number;
  onChange: (volume: number) => void;
}

export function VolumeControl({ volume, onChange }: VolumeControlProps) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className={styles.control}>
      <label htmlFor={id} className={styles.icon}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label={t('game.volume')}
        >
          <path d="M11 5 6 9H2v6h4l5 4V5z" />
          {volume > 0 ? <path d="M15.5 8.5a5 5 0 0 1 0 7" /> : null}
          {volume > 0.5 ? <path d="M19 5a10 10 0 0 1 0 14" /> : null}
        </svg>
      </label>
      <input
        id={id}
        className={styles.slider}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
