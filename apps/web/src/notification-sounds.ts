let context: AudioContext | undefined;

function audioContext() {
  if (typeof window === 'undefined' || !window.AudioContext) return undefined;
  context ??= new window.AudioContext();
  return context;
}

async function readyContext() {
  const audio = audioContext();
  if (!audio) return undefined;
  if (audio.state === 'suspended') {
    try {
      await audio.resume();
    } catch {
      return undefined;
    }
  }
  return audio.state === 'running' ? audio : undefined;
}

function tone(
  audio: AudioContext,
  frequency: number,
  startsIn: number,
  duration: number,
  volume: number,
) {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const startsAt = audio.currentTime + startsIn;
  const endsAt = startsAt + duration;
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startsAt);
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(volume, startsAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(startsAt);
  oscillator.stop(endsAt + 0.02);
}

export function installAudioUnlock() {
  const unlock = () => {
    void readyContext();
  };
  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}

export async function playMessageSound() {
  const audio = await readyContext();
  if (!audio) return;
  tone(audio, 660, 0, 0.09, 0.07);
  tone(audio, 880, 0.08, 0.12, 0.06);
}

export function startIncomingCallRingtone() {
  let stopped = false;
  const ring = async () => {
    const audio = await readyContext();
    if (!audio || stopped) return;
    tone(audio, 440, 0, 0.3, 0.08);
    tone(audio, 554, 0.34, 0.3, 0.08);
    tone(audio, 659, 0.68, 0.38, 0.08);
  };
  void ring();
  const timer = window.setInterval(() => void ring(), 2400);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
