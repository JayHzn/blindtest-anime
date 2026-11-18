import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  AUCTION,
  normalize,
  PROGRESSIVE,
  type PlayerRoundResult,
  type RoundReveal,
} from '@blindtest/shared';
import type { GameSession } from '../../game/GameSession';
import { secondsLeft, useServerNow } from '../../hooks/useServerNow';
import { useI18n } from '../../i18n/context';
import { avatarColor } from '../../lib/avatar';
import { isBuffered } from '../../lib/videoPreloader';
import { AnswerRecap } from './AnswerRecap';
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
      // Arrivée après une erreur (nouvelle tentative réussie) : la vidéo remplace la jaquette.
      setFailed(false);
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
  const recap = Boolean(reveal.bonuses && mine && !mine.auction && !mine.playlist?.ownSong);
  const title = reveal.anime.title[lang];
  const seconds = secondsLeft(reveal.phaseEndsAt, now);
  const showCard = !hasVideo || failed || !playing;

  return (
    <div
      className={[
        styles.panel,
        reveal.playlist ? styles.withPlaylist : '',
        recap ? styles.withRecap : '',
      ].join(' ')}
    >
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
        </div>
      </div>

      <div className={styles.info}>
        <span className={styles.badge}>
          {t(`theme.${reveal.theme.type}`)} {reveal.theme.sequence}
        </span>
        <h2 className={styles.title}>{title}</h2>
        {normalize(reveal.anime.romaji) !== normalize(title) ? (
          <p className={styles.romaji}>{reveal.anime.romaji}</p>
        ) : null}
        {reveal.theme.song ? (
          <p className={styles.song}>
            « {reveal.theme.song} »{reveal.theme.artists ? ` — ${reveal.theme.artists}` : ''}
          </p>
        ) : null}

        {reveal.playlist ? <PlaylistBanner reveal={reveal} you={you} /> : null}

        {/* Ta réponse face à la bonne, et détail des points (modes où l'on tape un titre). */}
        {recap && mine ? <AnswerRecap reveal={reveal} result={mine} /> : null}

        <div className={styles.footer}>
          {recap ? null : mine?.auction ? (
            <AuctionOutcome result={mine} />
          ) : mine?.playlist?.ownSong ? (
            <span className={[styles.result, styles.own].join(' ')}>
              +{mine.points} · {t('playlist.reveal.ownSong')}
            </span>
          ) : mine?.correct ? (
            <span className={[styles.result, styles.found].join(' ')}>
              +{mine.points} ·{' '}
              {mine.tier !== null
                ? t('game.reveal.foundTier', {
                    s: t('game.seconds', {
                      s: ((PROGRESSIVE.tiersMs[mine.tier] ?? 0) / 1000).toLocaleString(lang),
                    }),
                  })
                : t('game.reveal.found', {
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

/**
 * Playlist : qui a choisi la chanson (ou tirée au hasard), combien l'ont trouvée,
 * points de qui l'a choisie, bonus et pari du joueur.
 */
function PlaylistBanner({ reveal, you }: { reveal: RoundReveal; you: string }) {
  const { t } = useI18n();
  const playlist = reveal.playlist!;
  const mine = reveal.results.find((result) => result.playerId === you);
  const myGuess = playlist.guesses.find((guess) => guess.playerId === you);
  const pseudoOf = (id: string) =>
    reveal.players.find((player) => player.id === id)?.pseudo ??
    playlist.choosers.find((chooser) => chooser.id === id)?.pseudo ??
    '?';

  const { found, answerers: total } = playlist;
  let foundText = t('playlist.reveal.foundMany', { found, total });
  if (found === 0) foundText = t('playlist.reveal.foundNone', { total });
  else if (found === 1) foundText = t('playlist.reveal.foundOne', { total });

  const chosen = playlist.choosers.length > 0;
  const first = playlist.choosers[0];
  return (
    <div className={styles.playlist}>
      <div className={[styles.chooser, chosen ? '' : styles.random].join(' ')}>
        {first ? (
          <span
            className={styles.chooserAvatar}
            style={{ background: avatarColor(first.id) }}
            aria-hidden="true"
          >
            {first.pseudo.charAt(0).toUpperCase()}
          </span>
        ) : null}
        <span className={styles.chooserText}>
          <span className={styles.chooserName}>
            {chosen
              ? t('playlist.reveal.chosenBy', {
                  names: playlist.choosers.map((c) => c.pseudo).join(t('playlist.and')),
                })
              : t('playlist.reveal.random')}
          </span>
          <span className={styles.chooserFound}>{foundText}</span>
        </span>
        {chosen && playlist.chooserPoints > 0 ? (
          <span className={styles.chooserPoints}>
            <span className={styles.chooserPointsValue}>+{playlist.chooserPoints}</span>
            <span className={styles.chooserPointsDetail}>
              {t('playlist.reveal.chooserPoints', { n: total - found })}
            </span>
          </span>
        ) : null}
      </div>

      {mine?.playlist && !mine.playlist.ownSong && mine.correct ? (
        <div className={styles.playlistBonuses}>
          {mine.playlist.foundBonus > 0 ? (
            <span className={styles.playlistBonus}>
              {t('playlist.bonus.found')} +{mine.playlist.foundBonus}
            </span>
          ) : null}
          {myGuess ? (
            <span
              className={[styles.playlistBonus, myGuess.correct ? '' : styles.guessWrong].join(' ')}
            >
              {t(myGuess.correct ? 'playlist.reveal.guessRight' : 'playlist.reveal.guessWrong', {
                name: myGuess.guess === null ? t('playlist.guess.nobody') : pseudoOf(myGuess.guess),
              })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Mode Enchères : ce que l'annonce du joueur lui a rapporté (ou coûté). */
function AuctionOutcome({ result }: { result: PlayerRoundResult }) {
  const { t, lang } = useI18n();
  const { bid, status } = result.auction!;
  if (bid === null) {
    return (
      <span className={[styles.result, styles.missed].join(' ')}>
        {t('game.reveal.auctionNoBid')}
      </span>
    );
  }
  const s = t('game.seconds', { s: ((AUCTION.bidsMs[bid] ?? 0) / 1000).toLocaleString(lang) });
  if (status === 'found') {
    return (
      <span className={[styles.result, styles.found].join(' ')}>
        +{result.points} · {t('game.reveal.auctionFound', { s })}
      </span>
    );
  }
  if (result.points < 0) {
    return (
      <span className={[styles.result, styles.missed].join(' ')}>
        {t('game.reveal.auctionWrong', { s, n: `−${-result.points}` })}
      </span>
    );
  }
  return (
    <span className={[styles.result, styles.missed].join(' ')}>
      {t('game.reveal.auctionWaiting', { s })}
    </span>
  );
}
