import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { normalizeRoomCode, type GameSettings } from '@blindtest/shared';
import { AppHeader } from './components/AppHeader';
import { Button } from './components/ui/Button';
import { Card } from './components/ui/Card';
import { GameSession } from './game/GameSession';
import { pendingRoomCode, RoomSession } from './game/RoomSession';
import { useGameSession } from './game/useGameSession';
import { useVolume } from './hooks/useVolume';
import { I18nProvider } from './i18n/I18nProvider';
import { useI18n } from './i18n/context';
import { unlockSfx } from './lib/sfx';
import { storage, STORAGE_KEYS } from './lib/storage';
import { Game } from './pages/Game';
import { Home } from './pages/Home';
import { Lobby } from './pages/Lobby';
import { Picking } from './pages/Picking';
import { Results } from './pages/Results';
import { Setup } from './pages/Setup';

type Screen = 'home' | 'setup' | 'game' | 'room';

export function App() {
  return (
    <I18nProvider>
      <Screens />
    </I18nProvider>
  );
}

const pseudo = (): string => storage.get(STORAGE_KEYS.pseudo) ?? '';

/** Lien d'invitation (`?room=ABCD`) qui n'est pas la room où l'on était déjà. */
function invitationCode(): string | null {
  const fromUrl = normalizeRoomCode(new URL(window.location.href).searchParams.get('room'));
  return fromUrl && fromUrl !== storage.get(STORAGE_KEYS.room) ? fromUrl : null;
}

function Screens() {
  const { t } = useI18n();
  const [screen, setScreen] = useState<Screen>('home');
  const [session, setSession] = useState<GameSession | null>(null);
  const [room, setRoom] = useState<RoomSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitedCode, setInvitedCode] = useState(invitationCode);
  const sessionRef = useRef<GameSession | null>(null);
  const roomRef = useRef<RoomSession | null>(null);
  const lastSettings = useRef<GameSettings | null>(null);
  const autoRejoin = useRef(false);
  const applyVolume = useCallback((volume: number) => {
    sessionRef.current?.setVolume(volume);
    roomRef.current?.setVolume(volume);
  }, []);
  const [volume, setVolume] = useVolume(applyVolume);

  const replaceSession = (next: GameSession | null) => {
    sessionRef.current?.dispose();
    sessionRef.current = next;
    setSession(next);
  };

  const replaceRoom = (next: RoomSession | null) => {
    roomRef.current?.dispose();
    roomRef.current = next;
    setRoom(next);
  };

  /** Démarre une partie solo (déclenché par un clic : débloque aussi le son). */
  const startGame = async (settings: GameSettings) => {
    unlockSfx();
    setStarting(true);
    setError(null);
    replaceSession(null);
    const next = new GameSession(settings, pseudo());
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

  /** Crée une room (sans code) ou en rejoint une. */
  const openRoom = useCallback(
    async (code?: string) => {
      unlockSfx();
      setStarting(true);
      setError(null);
      const result = await RoomSession.open(pseudo(), code);
      setStarting(false);
      if (!result.ok) {
        setError(t(`error.${result.error}`));
        return;
      }
      result.session.setVolume(volume);
      roomRef.current?.dispose();
      roomRef.current = result.session;
      setRoom(result.session);
      setInvitedCode(null);
      setScreen('room');
    },
    [t, volume],
  );

  // Rechargement de la page pendant une room : on y retourne automatiquement.
  useEffect(() => {
    if (autoRejoin.current) return;
    const code = pendingRoomCode();
    if (!code || invitationCode() || !pseudo()) return;
    // Hors du rendu en cours (openRoom met à jour l'état).
    const timer = window.setTimeout(() => {
      autoRejoin.current = true;
      void openRoom(code);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openRoom]);

  const goTo = (target: Screen) => {
    replaceSession(null);
    setError(null);
    setScreen(target);
  };

  const leaveRoom = () => {
    roomRef.current?.leave();
    replaceRoom(null);
    goTo('home');
  };

  if (screen === 'room' && room) {
    return (
      <RoomFlow
        room={room}
        volume={volume}
        onVolumeChange={setVolume}
        onLeave={leaveRoom}
        onClosed={() => {
          replaceRoom(null);
          goTo('home');
        }}
      />
    );
  }
  if (screen === 'game' && session) {
    return (
      <SoloFlow
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
  return (
    <Home
      invitedCode={invitedCode}
      busy={starting}
      error={error}
      onPlaySolo={() => goTo('setup')}
      onCreateRoom={() => void openRoom()}
      onJoinRoom={(code) => void openRoom(code)}
    />
  );
}

interface SoloFlowProps {
  session: GameSession;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onQuit: () => void;
  onReplay: () => void;
  onSettings: () => void;
  onHome: () => void;
}

/** Partie solo, puis résultats. */
function SoloFlow({ session, onReplay, onSettings, onHome, ...gameProps }: SoloFlowProps) {
  const state = useGameSession(session);
  if (state.status === 'ended') {
    return <Results state={state} actions={{ kind: 'solo', onReplay, onSettings, onHome }} />;
  }
  return <Game session={session} {...gameProps} />;
}

interface RoomFlowProps {
  room: RoomSession;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onLeave: () => void;
  onClosed: () => void;
}

/** Room : salon, partie lancée par l'hôte, résultats, retour au salon. */
function RoomFlow({ room, volume, onVolumeChange, onLeave, onClosed }: RoomFlowProps) {
  const { t } = useI18n();
  const { game, closed, room: roomState } = useSyncExternalStore(room.subscribe, room.getState);

  if (closed) {
    return (
      <div style={{ padding: 'var(--space-6)' }}>
        <AppHeader />
        <Card style={{ maxWidth: 480, margin: '15vh auto 0', textAlign: 'center' }}>
          <p>{t('room.closed')}</p>
          <Button onClick={onClosed}>{t('results.home')}</Button>
        </Card>
      </div>
    );
  }
  if (game) {
    return (
      <RoomGame
        game={game}
        volume={volume}
        onVolumeChange={onVolumeChange}
        onBackToLobby={() => room.backToLobby()}
        onLeave={onLeave}
      />
    );
  }
  if (roomState.status === 'picking') return <Picking session={room} onLeave={onLeave} />;
  return <Lobby session={room} onLeave={onLeave} />;
}

interface RoomGameProps {
  game: GameSession;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onBackToLobby: () => void;
  onLeave: () => void;
}

function RoomGame({ game, volume, onVolumeChange, onBackToLobby, onLeave }: RoomGameProps) {
  const state = useGameSession(game);
  if (state.status === 'ended') {
    return <Results state={state} actions={{ kind: 'room', onBackToLobby, onLeave }} />;
  }
  return <Game session={game} volume={volume} onVolumeChange={onVolumeChange} onQuit={onLeave} />;
}
