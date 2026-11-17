import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { search, type AnswerPayload, type SearchIndex, type TitleEntry } from '@blindtest/shared';
import { useI18n } from '../../i18n/context';
import styles from './AnswerForm.module.css';

const MAX_SUGGESTIONS = 6;

interface AnswerFormProps {
  index: SearchIndex | null;
  disabled: boolean;
  /** Incrémenté à chaque mauvaise réponse (déclenche l'animation). */
  wrongCount: number;
  onSubmit: (answer: AnswerPayload) => void;
}

/** Champ de réponse avec autocomplétion locale (aucune requête réseau par frappe). */
export function AnswerForm({ index, disabled, wrongCount, onSubmit }: AnswerFormProps) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [sequence, setSequence] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const sequenceId = useId();

  const suggestions = useMemo(
    () => (index && text.trim() ? search(index, text, MAX_SUGGESTIONS).map((r) => r.entry) : []),
    [index, text],
  );
  const showList = open && suggestions.length > 0 && !disabled;

  const submit = (entry?: TitleEntry) => {
    const typed = entry ? entry[lang] : text.trim();
    if (!typed || disabled) return;
    const number = Number.parseInt(sequence, 10);
    onSubmit({
      text: typed,
      ...(entry && { pick: { kind: entry.k === 'f' ? 'franchise' : 'anime', id: entry.id } }),
      ...(Number.isInteger(number) && number > 0 && { sequence: number }),
    });
    // Champ vidé tout de suite : en cas d'erreur, le joueur retape directement.
    setText('');
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      submit(showList ? suggestions[highlight] : undefined);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={styles.row}>
        <div
          key={wrongCount}
          className={[styles.field, wrongCount > 0 ? styles.shake : ''].join(' ')}
        >
          {/* Remonté à chaque erreur (clé) : autoFocus redonne la main au joueur. */}
          <input
            autoFocus
            className={styles.input}
            value={text}
            disabled={disabled}
            placeholder={index ? t('game.answer.placeholder') : t('game.titlesLoading')}
            aria-label={t('game.answer.label')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList ? `${listId}-${highlight}` : undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setText(event.target.value);
              setHighlight(0);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setOpen(false)}
            onFocus={() => setOpen(true)}
          />
          <button type="submit" className={styles.submit} disabled={disabled || !text.trim()}>
            {t('game.submit')}
          </button>

          {showList ? (
            <ul id={listId} role="listbox" className={styles.list}>
              {suggestions.map((entry, i) => (
                <li
                  key={`${entry.k}${entry.id}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  className={[styles.option, i === highlight ? styles.highlighted : ''].join(' ')}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => submit(entry)}
                >
                  <span className={styles.optionTitle}>{entry[lang]}</span>
                  {entry.k === 'f' ? (
                    <span className={styles.tag}>{t('game.suggestion.franchise')}</span>
                  ) : entry.s ? (
                    <span className={[styles.tag, styles.tagSeason].join(' ')}>
                      {t('game.suggestion.season')} · +25
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className={styles.sequence}>
        <label htmlFor={sequenceId}>{t('game.sequence.label')}</label>
        <input
          id={sequenceId}
          className={styles.sequenceInput}
          inputMode="numeric"
          maxLength={3}
          value={sequence}
          disabled={disabled}
          onChange={(event) => setSequence(event.target.value.replace(/\D/g, ''))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        <span className={styles.sequenceHint}>{t('game.sequence.hint')}</span>
      </div>
    </form>
  );
}
