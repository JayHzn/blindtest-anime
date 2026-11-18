import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
  /** Champ « N° OP/ED » et mention « Saison · +25 » (pas de bonus de précision en Enchères). */
  bonuses?: boolean;
}

/** Champ de réponse avec autocomplétion locale (aucune requête réseau par frappe). */
export function AnswerForm({
  index,
  disabled,
  wrongCount,
  onSubmit,
  bonuses = true,
}: AnswerFormProps) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [sequence, setSequence] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  /** Suggestion choisie, pas encore validée (le temps de taper le numéro d'OP/ED). */
  const [picked, setPicked] = useState<TitleEntry | null>(null);
  const listId = useId();
  const sequenceId = useId();
  const sequenceRef = useRef<HTMLInputElement>(null);
  // Anime à un seul opening et un seul ending : le numéro n'apporte rien.
  const showSequence = bonuses && !picked?.u;

  const suggestions = useMemo(
    () => (index && text.trim() ? search(index, text, MAX_SUGGESTIONS).map((r) => r.entry) : []),
    [index, text],
  );
  const showList = open && suggestions.length > 0 && !disabled;

  const submit = (entry: TitleEntry | null = picked) => {
    const typed = entry ? entry[lang] : text.trim();
    if (!typed || disabled) return;
    const number = Number.parseInt(sequence, 10);
    const withSequence = bonuses && !entry?.u && Number.isInteger(number) && number > 0;
    onSubmit({
      text: typed,
      ...(entry && { pick: { kind: entry.k === 'f' ? 'franchise' : 'anime', id: entry.id } }),
      ...(withSequence && { sequence: number }),
    });
    // Champ vidé tout de suite : en cas d'erreur, le joueur retape directement.
    setText('');
    setPicked(null);
    setOpen(false);
  };

  /**
   * Suggestion choisie : elle est validée tout de suite si le numéro d'OP/ED est déjà
   * tapé ou ne sert à rien (pas de bonus, ou un seul opening et un seul ending) ; sinon
   * elle s'inscrit dans le champ et la main passe au numéro, validé ensuite (Entrée ou
   * « Valider »).
   */
  const choose = (entry: TitleEntry) => {
    // Numéro déjà tapé (ou inutile) : on valide tout de suite, sans touche de plus.
    if (!bonuses || entry.u || sequence !== '') {
      submit(entry);
      return;
    }
    setPicked(entry);
    setText(entry[lang]);
    setOpen(false);
    sequenceRef.current?.focus();
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
      if (showList) choose(suggestions[highlight]!);
      else submit();
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
              setPicked(null);
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
                  onClick={() => choose(entry)}
                >
                  <span className={styles.optionTitle}>{entry[lang]}</span>
                  {entry.k === 'f' ? (
                    <span className={styles.tag}>{t('game.suggestion.franchise')}</span>
                  ) : entry.s && bonuses ? (
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

      {showSequence ? (
        <div className={styles.sequence}>
          <label htmlFor={sequenceId}>{t('game.sequence.label')}</label>
          <input
            ref={sequenceRef}
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
      ) : null}
    </form>
  );
}
