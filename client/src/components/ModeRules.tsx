import type { GameModeId } from '@blindtest/shared';
import { useI18n } from '../i18n/context';
import styles from './ModeRules.module.css';

interface ModeRulesProps {
  mode: GameModeId;
  /** `inline` : dans la grille des modes ; `aside` : carte à part, dans la marge de droite. */
  variant?: 'inline' | 'aside';
  className?: string;
  style?: React.CSSProperties;
}

/** Règles du mode choisi (3 points), visibles par tous. */
export function ModeRules({ mode, variant = 'inline', className, style }: ModeRulesProps) {
  const { t } = useI18n();
  return (
    <div
      className={[styles.rules, variant === 'aside' ? styles.aside : '', className ?? ''].join(' ')}
      style={style}
      aria-live="polite"
    >
      <h3 className={styles.title}>
        {t('setup.rules')} · {t(`setup.mode.${mode}`)}
      </h3>
      <ul className={styles.list}>
        {([1, 2, 3] as const).map((n) => (
          <li key={n}>{t(`setup.rules.${mode}.${n}`)}</li>
        ))}
      </ul>
    </div>
  );
}
