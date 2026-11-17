import type { ReactNode } from 'react';
import styles from './AppHeader.module.css';

interface AppHeaderProps {
  /** Contenu central (ex. progression de la partie). */
  center?: ReactNode;
  /** Contenu à droite (statut, langue, volume…). */
  children?: ReactNode;
}

export function AppHeader({ center, children }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <span className={styles.logo}>
        blindtest <span className={styles.accent}>anime</span> ♪
      </span>
      {center ? <div className={styles.center}>{center}</div> : null}
      <div className={styles.right}>{children}</div>
    </header>
  );
}
