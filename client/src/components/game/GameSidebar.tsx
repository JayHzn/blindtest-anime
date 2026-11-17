import type { PlayerScore, RoundReveal } from '@blindtest/shared';
import { useI18n } from '../../i18n/context';
import styles from './GameSidebar.module.css';

const AVATAR_COLORS = ['#FF9EC7', '#B9A6FF', '#8FF0C8', '#FFD58A', '#9ED8FF', '#FFB8A6'];

interface GameSidebarProps {
  players: PlayerScore[];
  you: string;
  history: RoundReveal[];
}

/** Score (classement en multi) et récapitulatif des manches jouées. */
export function GameSidebar({ players, you, history }: GameSidebarProps) {
  const { t, lang } = useI18n();
  const me = players.find((player) => player.id === you);

  return (
    <aside className={styles.sidebar}>
      {players.length > 1 ? (
        <ol className={styles.players}>
          {players.map((player, i) => (
            <li
              key={player.id}
              className={[styles.player, player.id === you ? styles.me : ''].join(' ')}
            >
              <span
                className={styles.avatar}
                style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                aria-hidden="true"
              >
                {player.pseudo.charAt(0).toUpperCase()}
              </span>
              <span className={styles.name}>{player.pseudo}</span>
              <span className={styles.points}>{player.score}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className={styles.scoreCard}>
          <span className={styles.scoreLabel}>{t('game.score')}</span>
          <span className={styles.score}>{me?.score ?? 0}</span>
        </div>
      )}

      {history.length > 0 ? (
        <section className={styles.history}>
          <h2 className={styles.historyTitle}>{t('game.history')}</h2>
          <ol className={styles.rounds}>
            {[...history].reverse().map((reveal) => {
              const mine = reveal.results.find((result) => result.playerId === you);
              return (
                <li key={reveal.round} className={styles.round}>
                  <span
                    className={[styles.mark, mine?.correct ? styles.markFound : ''].join(' ')}
                    aria-hidden="true"
                  >
                    {mine?.correct ? '✓' : '✗'}
                  </span>
                  <span className={styles.roundTitle}>{reveal.anime.title[lang]}</span>
                  <span className={styles.roundPoints}>{mine?.points ?? 0}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </aside>
  );
}
