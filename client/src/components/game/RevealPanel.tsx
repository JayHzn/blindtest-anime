import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RoundReveal } from '@blindtest/shared';
import type { GameSession } from '../../game/GameSession';
import { secondsLeft, useServerNow } from '../../hooks/useServerNow';
import { useI18n } from '../../i18n/context';
import { isBuffered } from '../../lib/videoPreloader';
import styles from './RevealPanel.module.css';

/** Avance prise sur l'extrait quand la vidéo doit encore charger la bonne portion. */
const LOADING_LEAD_S = 1.5;

interface RevealPanelProps {
  reveal: RoundReveal;
  session: GameSession;
  you: string;
  isLastRound: boolean;
}

/**
 * Révélation : la vidéo préchargée pendant l'écoute prend le relais de l'extrait,
 * au même endroit si cette partie est déjà téléchargée, sinon depuis le début.
 * Tant qu'elle ne joue pas, une carte titre s'affiche et l'extrait continue.
 */
export function RevealPanel({ reveal, session, you, isLastRound }: RevealPanelProps) {
  const { t, lang } = useI18n();
  const now = useServerNow();
  const host = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const hasVideo = session.video.get(reveal.round) !== null;

  useEffect(() => {
    const round = reveal.round;
    const element = session.video.get(round);
    const container = host.current;
    if (!element || !container) return;

    // Enchaînement sur l'extrait : position exacte si elle est déjà téléchargée,
    // sinon un peu en avance (le temps de charger), l'extrait continuant entre-temps.
    const position = session.audio.position(round);
    if (position !== null) {
      element.currentTime = isBuffered(element, position) ? position : position + LOADING_LEAD_S;
    }
    element.className = styles.video ?? '';
    container.appendChild(element);

    const onPlaying = () => {
      element.muted = false;
      session.audio.fadeOut(round, 300);
      setPlaying(true);
    };
    const onError = () => setFailed(true);
    element.addEventListener('playing', onPlaying);
    element.addEventListener('error', onError);
    if (element.error) queueMicrotask(onError);
    else void element.play().catch(() => {});

    return () => {
      element.removeEventListener('playing', onPlaying);
      element.removeEventListener('error', onError);
      element.pause();
      element.remove();
    };
  }, [reveal.round, session]);

  const mine = reveal.results.find((result) => result.playerId === you);
  const title = reveal.anime.title[lang];
  const seconds = secondsLeft(reveal.phaseEndsAt, now);
  const showCard = !hasVideo || failed || !playing;

  return (
    <div className={styles.panel}>
      <div className={styles.media}>
        <div ref={host} className={styles.videoHost} />
        {/* Jaquette tant que la vidéo charge, ou à sa place si elle échoue. */}
        <div
          className={[styles.placeholder, showCard ? '' : styles.hidden].join(' ')}
          style={
            reveal.anime.coverColor
              ? ({ '--cover-color': reveal.anime.coverColor } as CSSProperties)
              : undefined
          }
        >
          {reveal.anime.coverUrl ? (
            <>
              <img className={styles.coverBackdrop} src={reveal.anime.coverUrl} alt="" />
              <img className={styles.cover} src={reveal.anime.coverUrl} alt={title} />
            </>
          ) : (
            <span className={styles.placeholderTitle}>{title}</span>
          )}
          {!hasVideo || failed ? (
            <span className={styles.placeholderNote}>{t('game.reveal.noVideo')}</span>
          ) : null}
        </div>
      </div>

      <div className={styles.info}>
        <span className={styles.badge}>
          {t(`theme.${reveal.theme.type}`)} {reveal.theme.sequence}
        </span>
        <h2 className={styles.title}>{title}</h2>
        {reveal.anime.romaji !== title ? (
          <p className={styles.romaji}>{reveal.anime.romaji}</p>
        ) : null}
        {reveal.theme.song ? (
          <p className={styles.song}>
            « {reveal.theme.song} »{reveal.theme.artists ? ` — ${reveal.theme.artists}` : ''}
          </p>
        ) : null}

        <div className={styles.footer}>
          {mine?.correct ? (
            <span className={[styles.result, styles.found].join(' ')}>
              +{mine.points} ·{' '}
              {t('game.reveal.found', {
                s: ((mine.elapsedMs ?? 0) / 1000).toLocaleString(lang, {
                  maximumFractionDigits: 1,
                }),
              })}
            </span>
          ) : (
            <span className={[styles.result, styles.missed].join(' ')}>
              {t('game.reveal.missed')}
            </span>
          )}
          <span className={styles.next}>
            {t(isLastRound ? 'game.reveal.last' : 'game.reveal.next', { s: seconds })}
          </span>
        </div>
      </div>
    </div>
  );
}
