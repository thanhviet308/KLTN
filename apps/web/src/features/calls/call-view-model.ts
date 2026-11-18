export const PIP_CORNERS = [
  'top-right',
  'bottom-right',
  'bottom-left',
  'top-left',
] as const;

export type PipCorner = (typeof PIP_CORNERS)[number];
export type VideoFitMode = 'contain' | 'cover';
export type StageLayout = 'audio' | 'solo-preview' | 'one-to-one' | 'grid';

export function nextPipCorner(current: PipCorner): PipCorner {
  const index = PIP_CORNERS.indexOf(current);
  return PIP_CORNERS[(index + 1) % PIP_CORNERS.length];
}

export function formatCallDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function computeCallElapsedSeconds(input: {
  status?: string;
  startedAt?: string | null;
  fallbackActiveAtMs?: number | null;
  nowMs: number;
}): number {
  if (input.status !== 'active') return 0;
  const parsedStart = input.startedAt
    ? Date.parse(input.startedAt)
    : Number.NaN;
  const anchor = Number.isFinite(parsedStart)
    ? parsedStart
    : (input.fallbackActiveAtMs ?? input.nowMs);
  return Math.max(0, Math.floor((input.nowMs - anchor) / 1000));
}

export function resolveStageVideoState(input: {
  callType: 'audio' | 'video';
  callStatus: string;
  hasLocalVideo: boolean;
  remoteVideoCount: number;
  remoteParticipantCount?: number;
  swapped?: boolean;
  pipCollapsed?: boolean;
  hasError?: boolean;
  isMinimized?: boolean;
}): {
  layout: StageLayout;
  effectiveSwapped: boolean;
  showHeroOverlay: boolean;
  canAutoHideChrome: boolean;
} {
  if (input.callType === 'audio') {
    return {
      layout: 'audio',
      effectiveSwapped: false,
      showHeroOverlay: true,
      canAutoHideChrome: false,
    };
  }

  const remotePeers = input.remoteParticipantCount ?? input.remoteVideoCount;
  if (remotePeers >= 2 || input.remoteVideoCount >= 2) {
    return {
      layout: 'grid',
      effectiveSwapped: false,
      showHeroOverlay: false,
      canAutoHideChrome:
        input.callStatus === 'active' &&
        input.remoteVideoCount > 0 &&
        !input.hasError &&
        !input.isMinimized,
    };
  }

  if (
    input.callStatus === 'ringing' &&
    input.remoteVideoCount === 0 &&
    input.hasLocalVideo
  ) {
    return {
      layout: 'solo-preview',
      effectiveSwapped: false,
      showHeroOverlay: true,
      canAutoHideChrome: false,
    };
  }

  const effectiveSwapped =
    input.remoteVideoCount === 1 &&
    input.hasLocalVideo &&
    Boolean(input.swapped) &&
    !input.pipCollapsed;

  return {
    layout: 'one-to-one',
    effectiveSwapped,
    showHeroOverlay: input.remoteVideoCount === 0,
    canAutoHideChrome:
      input.callStatus === 'active' &&
      input.remoteVideoCount > 0 &&
      !input.hasError &&
      !input.isMinimized,
  };
}
