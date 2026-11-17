import type { PlayerScore, RoundReveal } from '@blindtest/shared';
import { useI18n } from '../../i18n/context';
import { avatarColor } from '../../lib/avatar';
import { formatScore } from '../../lib/score';
import styles from './GameSidebar.module.css';

export interface PlayerBadge {
  label: string;
  tone: 'ok' | 'wait' | 'hand' | 'ko';
}

interface GameSidebarProps {
  players: PlayerScore[];
  you: string;
  history: RoundReveal[];
  /** Mode Enchères : état de chaque joueur dans la manche (a annoncé, a la main, 2ᵉ…). */
  badges?: Record<string, PlayerBadge>;
}

const BADGE_CLASS: Record<PlayerBadge['tone'], string | undefined> = {
  ok: styles.badgeOk,
  wait: styles.badgeWait,
  hand: styles.badgeHand,
  ko: styles.badgeKo,
};

/** Score (classement en multi) et récapitulatif des manches jouées. */
export function GameSidebar({ players, you, history, badges }: GameSidebarProps) {
  const { t, lang } = useI18n();
  const me = players.find((player) => player.id === you);

  return (
    <aside className={styles.sidebar}>
      {players.length > 1 ? (
        <section className={styles.ranking}>
          <h2 className={styles.historyTitle}>{t('game.players')}</h2>
          {/* Classement en direct : on voit qui a trouvé, jamais la réponse. */}
          <ol className={styles.players}>
            {players.map((player, i) => (
              <li
                key={player.id}
                className={[
                  styles.player,
                  player.id === you ? styles.me : '',
                  player.connected ? '' : styles.offline,
                ].join(' ')}
              >
                <span className={styles.rank}>{i + 1}</span>
                <span
                  className={styles.avatar}
                  style={{ background: avatarColor(player.id) }}
                  aria-hidden="true"
                >
                  {player.pseudo.charAt(0).toUpperCase()}
                </span>
                <span className={styles.name}>{player.pseudo}</span>
                {badges?.[player.id] ? (
                  <span className={[styles.badge, BADGE_CLASS[badges[player.id]!.tone]].join(' ')}>
                    {badges[player.id]!.label}
                  </span>
                ) : player.found ? (
                  <span className={styles.found} title={t('game.found')}>
                    <span aria-hidden="true">✓</span>
                    <span className={styles.srOnly}>{t('game.found')}</span>
                  </span>
                ) : null}
                <span
                  className={[styles.points, player.score < 0 ? styles.negative : ''].join(' ')}
                >
                  {formatScore(player.score)}
                </span>
              </li>
            ))}
          </ol>
        </section>
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
                  <span className={styles.roundPoints}>{formatScore(mine?.points ?? 0)}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </aside>
  );
}
