import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Petit badge affiché à droite du libellé (ex. « Bientôt »). */
  badge?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  badge,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
      {badge ? <span className={styles.badge}>{badge}</span> : null}
    </button>
  );
}
