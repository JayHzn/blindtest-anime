import styles from './Vinyl.module.css';

interface VinylProps {
  size?: number;
  spinning?: boolean;
}

/** Disque vinyle décoratif de la direction Sakura. */
export function Vinyl({ size = 200, spinning = true }: VinylProps) {
  return (
    <div
      className={[styles.vinyl, spinning ? styles.spinning : ''].join(' ')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <div className={styles.label}>
        <svg
          width={size * 0.15}
          height={size * 0.15}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
    </div>
  );
}
