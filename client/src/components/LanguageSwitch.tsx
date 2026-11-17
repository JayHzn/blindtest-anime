import { LANGS, useI18n } from '../i18n/context';
import styles from './LanguageSwitch.module.css';

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={styles.switch} role="group" aria-label={t('lang.label')}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          className={[styles.option, code === lang ? styles.active : ''].join(' ')}
          aria-pressed={code === lang}
          onClick={() => setLang(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
