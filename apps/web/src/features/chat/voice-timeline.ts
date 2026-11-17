export function validVoiceDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function resolveVoiceDuration({
  decodedDuration,
  storedDuration,
  elementDuration,
  decodeFinished,
}: {
  decodedDuration?: number;
  storedDuration?: number;
  elementDuration?: number;
  decodeFinished?: boolean;
}) {
  if (validVoiceDuration(decodedDuration)) return decodedDuration;
  if (validVoiceDuration(storedDuration)) return storedDuration;
  if (decodeFinished && validVoiceDuration(elementDuration))
    return elementDuration;
  return 0;
}

export function voiceTimeline(current: number, duration: number) {
  const known = validVoiceDuration(duration);
  const rawElapsed = Number.isFinite(current) ? Math.max(0, current) : 0;
  const elapsed = known ? Math.min(rawElapsed, duration) : rawElapsed;
  return {
    known,
    max: known ? duration : 1,
    // An unknown duration must never look like a completed recording.
    value: known ? elapsed : 0,
    elapsed,
  };
}

export async function decodeVoiceDurationFromBytes(bytes: ArrayBuffer) {
  const AudioCtx =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return 0;
  const context = new AudioCtx();
  try {
    const buffer = await context.decodeAudioData(bytes);
    return validVoiceDuration(buffer.duration) ? buffer.duration : 0;
  } finally {
    await context.close().catch(() => {});
  }
}

// MediaRecorder WebM/MP4 files may omit or report bogus duration metadata.
// Decode the complete recording rather than trusting container headers.
export async function decodeVoiceDuration(source: string, signal: AbortSignal) {
  const response = await fetch(source, { signal });
  if (!response.ok) throw new Error('Cannot load voice duration');
  const bytes = await response.arrayBuffer();
  if (signal.aborted) return 0;
  return decodeVoiceDurationFromBytes(bytes);
}

export async function measureVoiceDurationSeconds(
  file: Blob,
  fallbackSeconds?: number,
) {
  try {
    const decoded = await decodeVoiceDurationFromBytes(
      await file.arrayBuffer(),
    );
    if (validVoiceDuration(decoded)) {
      return Math.max(1, Math.round(decoded));
    }
  } catch {
    // Fall back to elapsed recorder time when decoding is unsupported.
  }
  return validVoiceDuration(fallbackSeconds)
    ? Math.max(1, Math.round(fallbackSeconds))
    : undefined;
}
