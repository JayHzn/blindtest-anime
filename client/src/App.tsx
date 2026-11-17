import { useCallback, useRef, useState } from 'react';
import type { GameSettings } from '@blindtest/shared';
import { GameSession } from './game/GameSession';
import { useGameSession } from './game/useGameSession';
import { useVolume } from './hooks/useVolume';
import { I18nProvider } from './i18n/I18nProvider';
import { useI18n } from './i18n/context';
import { unlockSfx } from './lib/sfx';
import { storage, STORAGE_KEYS } from './lib/storage';
import { Game } from './pages/Game';
import { Home } from './pages/Home';
import { Results } from './pages/Results';
import { Setup } from './pages/Setup';

type Screen = 'home' | 'setup' | 'game';

export function App() {
  return (
    <I18nProvider>
      <Screens />
    </I18nProvider>
  );
}

function Screens() {
  const { t } = useI18n();
  const [screen, setScreen] = useState<Screen>('home');
  const [session, setSession] = useState<GameSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const lastSettings = useRef<GameSettings | null>(null);
  const applyVolume = useCallback((volume: number) => sessionRef.current?.setVolume(volume), []);
  const [volume, setVolume] = useVolume(applyVolume);

  const replaceSession = (next: GameSession | null) => {
    sessionRef.current?.dispose();
    sessionRef.current = next;
    setSession(next);
  };

  /** Démarre une partie (déclenché par un clic : débloque aussi le son). */
  const startGame = async (settings: GameSettings) => {
    unlockSfx();
    setStarting(true);
    setError(null);
    replaceSession(null);
    const next = new GameSession(settings, storage.get(STORAGE_KEYS.pseudo) ?? '');
    next.setVolume(volume);
    const ok = await next.start();
    setStarting(false);
    if (!ok) {
      const reason = next.getState().error ?? 'connection';
      next.dispose();
      setError(t(`error.${reason}`));
      setScreen('setup');
      return;
    }
    lastSettings.current = settings;
    replaceSession(next);
    setScreen('game');
  };

  const goTo = (target: Screen) => {
    replaceSession(null);
    setError(null);
    setScreen(target);
  };

  if (screen === 'game' && session) {
    return (
      <GameFlow
        session={session}
        volume={volume}
        onVolumeChange={setVolume}
        onQuit={() => goTo('setup')}
        onReplay={() => lastSettings.current && void startGame(lastSettings.current)}
        onSettings={() => goTo('setup')}
        onHome={() => goTo('home')}
      />
    );
  }
  if (screen === 'setup') {
    return (
      <Setup
        error={error}
        starting={starting}
        onBack={() => goTo('home')}
        onStart={(settings) => void startGame(settings)}
      />
    );
  }
  return <Home onPlaySolo={() => goTo('setup')} />;
}

interface GameFlowProps {
  session: GameSession;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onQuit: () => void;
  onReplay: () => void;
  onSettings: () => void;
  onHome: () => void;
}

/** Écran de jeu, puis résultats quand la partie se termine. */
function GameFlow({ session, onReplay, onSettings, onHome, ...gameProps }: GameFlowProps) {
  const state = useGameSession(session);
  if (state.status === 'ended') {
    return <Results state={state} onReplay={onReplay} onSettings={onSettings} onHome={onHome} />;
  }
  return <Game session={session} {...gameProps} />;
}
