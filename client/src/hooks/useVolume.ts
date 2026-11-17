import { useCallback, useState } from 'react';
import { setSfxVolume } from '../lib/sfx';
import { storage, STORAGE_KEYS } from '../lib/storage';

const DEFAULT_VOLUME = 0.8;

export function readVolume(): number {
  const raw = storage.get(STORAGE_KEYS.volume);
  if (raw === null) return DEFAULT_VOLUME;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_VOLUME;
}

/** Volume global (musique, vidéo, effets), mémorisé dans le navigateur. */
export function useVolume(onChange?: (volume: number) => void): [number, (volume: number) => void] {
  const [volume, setVolumeState] = useState(readVolume);
  const setVolume = useCallback(
    (next: number) => {
      setVolumeState(next);
      storage.set(STORAGE_KEYS.volume, String(next));
      setSfxVolume(next);
      onChange?.(next);
    },
    [onChange],
  );
  return [volume, setVolume];
}
