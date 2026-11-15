export function validVoiceDuration(value: number) {
  return Number.isFinite(value) && value > 0;
}

export function voiceTimeline(current: number, duration: number) {
  const known = validVoiceDuration(duration);
  const elapsed = Number.isFinite(current) ? Math.max(0, current) : 0;
  return {
    known,
    max: known ? duration : 1,
    // An unknown duration must never look like a completed recording.
    value: known ? Math.min(elapsed, duration) : 0,
    elapsed,
  };
}

// MediaRecorder WebM files may omit duration metadata. Decode the complete
// recording rather than using buffered/seekable ranges as its total length.
export async function decodeVoiceDuration(source: string, signal: AbortSignal) {
  const response = await fetch(source, { signal });
  if (!response.ok) throw new Error('Cannot load voice duration');
  const bytes = await response.arrayBuffer();
  if (signal.aborted) return 0;
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(bytes);
    return validVoiceDuration(buffer.duration) ? buffer.duration : 0;
  } finally {
    await context.close();
  }
}
