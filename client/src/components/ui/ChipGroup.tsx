import styles from './ChipGroup.module.css';

export interface ChipOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface ChipGroupProps<T> {
  label: string;
  options: ChipOption<T>[];
  /** Valeurs sélectionnées (une seule en mode radio). */
  selected: T[];
  onToggle: (value: T) => void;
  multiple?: boolean;
}

/** Groupe de pastilles cliquables (choix unique ou multiple). */
export function ChipGroup<T extends string | number>({
  label,
  options,
  selected,
  onToggle,
  multiple = false,
}: ChipGroupProps<T>) {
  return (
    <div className={styles.group} role={multiple ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <button
            key={String(option.value)}
            type="button"
            role={multiple ? undefined : 'radio'}
            aria-checked={multiple ? undefined : active}
            aria-pressed={multiple ? active : undefined}
            disabled={option.disabled}
            className={[styles.chip, active ? styles.active : ''].join(' ')}
            onClick={() => onToggle(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
