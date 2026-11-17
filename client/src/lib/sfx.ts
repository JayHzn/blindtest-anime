/**
 * Effets sonores générés avec la Web Audio API : rien à télécharger,
 * aucune latence, aucun souci de licence.
 */
let context: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.8;

/** À appeler depuis un clic (les navigateurs exigent une action de l'utilisateur). */
export function unlockSfx(): void {
  if (!context) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = volume * 0.5;
    master.connect(context.destination);
  }
  void context.resume();
}

export function setSfxVolume(next: number): void {
  volume = next;
  if (master) master.gain.value = next * 0.5;
}

interface Note {
  frequency: number;
  start?: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

function play(notes: Note[]): void {
  if (!context || !master) return;
  const now = context.currentTime;
  for (const note of notes) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const start = now + (note.start ?? 0);
    const peak = note.gain ?? 0.6;
    oscillator.type = note.type ?? 'sine';
    oscillator.frequency.value = note.frequency;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
    oscillator.connect(envelope).connect(master);
    oscillator.start(start);
    oscillator.stop(start + note.duration + 0.05);
  }
}

export const sfx = {
  /** Cloche « attention, prochaine manche ». */
  bell: () =>
    play([
      { frequency: 880, duration: 1.4, gain: 0.5 },
      { frequency: 1760, duration: 0.9, gain: 0.2 },
      { frequency: 2640, duration: 0.5, gain: 0.08 },
    ]),
  /** Tic du compte à rebours. */
  tick: () => play([{ frequency: 1200, duration: 0.06, type: 'triangle', gain: 0.3 }]),
  /** Bonne réponse : petit arpège montant. */
  correct: () =>
    play([
      { frequency: 1046.5, duration: 0.18, type: 'triangle' },
      { frequency: 1318.5, start: 0.08, duration: 0.18, type: 'triangle' },
      { frequency: 1568, start: 0.16, duration: 0.35, type: 'triangle' },
    ]),
  /** Mauvaise réponse : son grave et court. */
  wrong: () =>
    play([
      { frequency: 196, duration: 0.18, type: 'square', gain: 0.18 },
      { frequency: 147, start: 0.1, duration: 0.25, type: 'square', gain: 0.18 },
    ]),
};
