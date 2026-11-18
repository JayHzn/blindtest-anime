import type { ImpostorReveal } from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/ui/Button';
import type { SessionState } from '../game/GameSession';
import { useI18n } from '../i18n/context';
import { avatarColor } from '../lib/avatar';
import type { ResultsActions } from './Results';
import hl from './HigherLowerResults.module.css';

interface Props {
  state: SessionState;
  actions: ResultsActions;
}

interface Stats {
  impostorRounds: number;
  impostorWins: number;
  guessed: number;
}

/** Fin de partie Imposteur, d'après la maquette : gagnant, classement, faits marquants. */
export function ImpostorResults({ state, actions }: Props) {
  const { t } = useI18n();
  const rounds = state.history
    .map((reveal) => reveal.impostor)
    .filter((round): round is ImpostorReveal => round !== undefined);
  const stats = new Map<string, Stats>();
  for (const round of rounds) {
    for (const p of round.players) {
      const entry = stats.get(p.playerId) ?? { impostorRounds: 0, impostorWins: 0, guessed: 0 };
      if (p.impostor) {
        entry.impostorRounds++;
        if (round.winner === 'impostors') entry.impostorWins++;
      }
      if (p.guessed) entry.guessed++;
      stats.set(p.playerId, entry);
    }
  }
  const civilsWins = rounds.filter((round) => round.winner === 'civils').length;
  const best = [...stats.entries()]
    .filter(([, s]) => s.impostorWins > 0)
    .sort((a, b) => b[1].impostorWins - a[1].impostorWins)[0];
  const winner = state.players[0];
  const pseudo = (id: string) => state.players.find((p) => p.id === id)?.pseudo ?? '?';
  const roundsLabel = (n: number) => t(n > 1 ? 'imp.rounds.many' : 'imp.rounds.one', { n });

  const detail = (id: string): string => {
    const s = stats.get(id);
    if (!s) return t('imp.end.watched');
    const parts: string[] = [];
    if (s.impostorRounds > 0) {
      const won = t(s.impostorWins > 1 ? 'imp.end.wonMany' : 'imp.end.won', { n: s.impostorWins });
      parts.push(
        `${t(s.impostorRounds > 1 ? 'imp.end.impostorMany' : 'imp.end.impostorOne', { n: s.impostorRounds })} (${won})`,
      );
    } else {
      parts.push(t('imp.end.alwaysCivil'));
    }
    if (s.guessed > 0) {
      parts.push(t(s.guessed > 1 ? 'imp.end.guessedMany' : 'imp.end.guessedOne', { n: s.guessed }));
    }
    return parts.join(' · ');
  };

  const pill = [
    t('setup.mode.impostor'),
    actions.kind === 'room' && actions.code ? t('hl.results.room', { code: actions.code }) : null,
    t('hl.results.players', { n: state.players.length }),
    roundsLabel(rounds.length),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={hl.page}>
      <AppHeader center={<span className={hl.pill}>{pill}</span>} />
      <main className={hl.main}>
        {winner ? (
          <>
            <span
              className={hl.crownBig}
              style={{ background: avatarColor(winner.id) }}
              aria-hidden="true"
            >
              {winner.pseudo.charAt(0).toUpperCase()}
            </span>
            <h1 className={hl.winner}>
              {winner.id === state.you ? (
                t('hl.results.winnerYou')
              ) : (
                <>
                  <span>{winner.pseudo}</span> {t('hl.results.wins')}
                </>
              )}
            </h1>
          </>
        ) : null}
        {state.end?.reason === 'audio_unavailable' ? (
          <p className={hl.warning}>{t('results.audioUnavailable')}</p>
        ) : null}
        <ol className={hl.board}>
          {state.players.map((player, i) => (
            <li key={player.id} className={[hl.row, i === 0 ? hl.first : ''].join(' ')}>
              <span className={hl.rank}>{i + 1}</span>
              <span
                className={hl.avatar}
                style={{ background: avatarColor(player.id) }}
                aria-hidden="true"
              >
                {player.pseudo.charAt(0).toUpperCase()}
              </span>
              <span className={hl.who}>
                <b className={player.id === state.you ? hl.you : ''}>
                  {player.pseudo}
                  {player.id === state.you ? ` ${t('hl.you')}` : ''}
                </b>
                <small>{detail(player.id)}</small>
              </span>
              <span className={hl.stat}>{player.score}</span>
            </li>
          ))}
        </ol>
        {rounds.length > 0 ? (
          <div className={hl.facts}>
            {best ? (
              <span className={hl.fact}>
                {t('imp.end.best')} <b>{pseudo(best[0])}</b>{' '}
                {t(best[1].impostorWins > 1 ? 'imp.end.bestWinsMany' : 'imp.end.bestWinsOne', {
                  n: best[1].impostorWins,
                })}
              </span>
            ) : null}
            <span className={hl.fact}>
              {t('imp.end.civils')} <b>{roundsLabel(civilsWins)}</b> · {t('imp.end.impostors')}{' '}
              <b>{roundsLabel(rounds.length - civilsWins)}</b>
            </span>
          </div>
        ) : null}
        <div className={hl.actions}>
          {actions.kind === 'room' ? (
            <Button size="lg" onClick={actions.onBackToLobby}>
              {t('results.backToLobby')}
            </Button>
          ) : (
            <Button size="lg" onClick={actions.onHome}>
              {t('results.home')}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
