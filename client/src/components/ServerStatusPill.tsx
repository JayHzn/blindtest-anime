import type { ServerStatus } from '../hooks/useServerStatus';
import { useI18n } from '../i18n/context';
import styles from './ServerStatusPill.module.css';

interface Props {
  status: ServerStatus;
  onRetry: () => void;
}

export function ServerStatusPill({ status, onRetry }: Props) {
  const { t } = useI18n();
  return (
    <div className={styles.pill} role="status" aria-live="polite">
      <span className={[styles.dot, styles[status]].join(' ')} />
      <span>{t(`server.${status}`)}</span>
      {status === 'unreachable' ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {t('server.retry')}
        </button>
      ) : null}
    </div>
  );
}
