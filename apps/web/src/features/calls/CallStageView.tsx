import { useEffect, useRef, type RefObject } from 'react';
import type { LocalTrack, RemoteTrack } from 'livekit-client';
import {
  ArrowLeftRight,
  CornerUpRight,
  Expand,
  Eye,
  EyeOff,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneOff,
  PictureInPicture2,
  Shrink,
  Sparkles,
  SwitchCamera,
  Video,
  VideoOff,
  WifiOff,
} from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import type { Peer } from '../../lib/types';
import {
  formatCallDuration,
  type PipCorner,
  type StageLayout,
  type VideoFitMode,
} from './call-view-model';

export interface MediaTrackItem {
  key: string;
  track: RemoteTrack | LocalTrack;
  local: boolean;
  kind: 'audio' | 'video';
  participantIdentity: string;
  participantName: string;
  isMirrored?: boolean;
  isSpeaking?: boolean;
  audioMuted?: boolean;
}

export interface RemoteParticipantTile {
  identity: string;
  name: string;
  hasVideo: boolean;
  audioMuted: boolean;
  isSpeaking: boolean;
}

function AttachedTrack({
  item,
  roleClass,
  pipCorner,
  videoFit,
  canSwap,
  isMinimized,
  onSwap,
  onCycleCorner,
  onCollapsePip,
}: {
  item: MediaTrackItem;
  roleClass: string;
  pipCorner: PipCorner;
  videoFit: VideoFitMode;
  canSwap: boolean;
  isMinimized: boolean;
  onSwap?: () => void;
  onCycleCorner?: () => void;
  onCollapsePip?: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = item.track.attach();
    element.autoplay = true;
    if (element instanceof HTMLVideoElement) {
      element.playsInline = true;
      element.setAttribute('playsinline', '');
      element.setAttribute('webkit-playsinline', '');
      element.muted = item.local;
    }
    holder.current?.prepend(element);
    void element.play().catch(() => {});
    return () => {
      item.track.detach(element);
      element.remove();
    };
  }, [item.track, item.local]);

  const isPip = roleClass === 'is-pip';
  const isPrimary = roleClass === 'is-primary';
  const isGridTile = roleClass === 'is-grid-tile';

  const classes = [
    'call-track',
    item.kind,
    item.local ? 'local' : 'remote',
    roleClass,
    isPip ? `corner-${pipCorner}` : '',
    item.isMirrored ? 'is-mirrored' : 'no-mirror',
    isPrimary && videoFit === 'cover' ? 'fit-cover' : '',
    item.isSpeaking ? 'is-speaking' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      ref={holder}
      onClick={
        isPip && !isMinimized
          ? (event) => {
              event.stopPropagation();
              if (canSwap && onSwap) onSwap();
              else onCycleCorner?.();
            }
          : undefined
      }
      title={
        isPip && !isMinimized
          ? canSwap
            ? 'Chạm để đổi khung hình chính/phụ'
            : 'Chạm để đổi vị trí góc hiển thị'
          : undefined
      }
    >
      {item.kind === 'video' && isPip && !isMinimized && (
        <div
          className="call-pip-toolbar"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="call-pip-label">
            {item.local ? 'Bạn' : item.participantName}
          </span>
          <div className="call-pip-actions">
            {canSwap && onSwap && (
              <button
                type="button"
                className="call-pip-btn"
                onClick={onSwap}
                aria-label="Đổi khung hình chính và phụ"
                title="Đổi khung hình chính/phụ"
              >
                <ArrowLeftRight size={13} />
              </button>
            )}
            {onCycleCorner && (
              <button
                type="button"
                className="call-pip-btn"
                onClick={onCycleCorner}
                aria-label="Đổi góc khung hình phụ"
                title="Đổi góc hiển thị"
              >
                <CornerUpRight size={13} />
              </button>
            )}
            {onCollapsePip && (
              <button
                type="button"
                className="call-pip-btn"
                onClick={onCollapsePip}
                aria-label="Ẩn khung hình phụ"
                title="Ẩn khung hình phụ"
              >
                <EyeOff size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {item.kind === 'video' && isGridTile && !isMinimized && (
        <div className="call-tile-meta">
          <span className="call-tile-name">
            {item.local ? 'Bạn' : item.participantName}
          </span>
          {item.audioMuted && (
            <span className="call-tile-muted" title="Đã tắt mic">
              <MicOff size={13} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
export interface CallStageViewProps {
  windowRef: RefObject<HTMLElement | null>;
  callType: 'audio' | 'video';
  callStatus: string;
  callTitle: string;
  avatarPeer: Pick<Peer, 'displayName' | 'avatarUrl'>;
  hasRoom: boolean;
  incoming: boolean;
  busy: boolean;
  error: string;
  reconnecting: boolean;
  elapsedSeconds: number;
  summaryAvailable: boolean;
  microphone: boolean;
  camera: boolean;
  canSwitchCamera: boolean;
  tracks: MediaTrackItem[];
  remotePeers: RemoteParticipantTile[];
  remoteVideoCount: number;
  hasLocalVideo: boolean;
  layout: StageLayout;
  effectiveSwapped: boolean;
  showHeroOverlay: boolean;
  canAutoHideChrome: boolean;
  chromeHidden: boolean;
  pipCorner: PipCorner;
  pipCollapsed: boolean;
  videoFit: VideoFitMode;
  isMinimized: boolean;
  miniCorner: PipCorner;
  isFullscreen: boolean;
  fullscreenSupported: boolean;
  onRevealChrome: () => void;
  onToggleStageChrome: () => void;
  onToggleMicrophone: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  onAccept: () => void;
  onReject: () => void;
  onHangup: () => void;
  onRejoin: () => void;
  onToggleSwap: () => void;
  onCyclePipCorner: () => void;
  onCollapsePip: () => void;
  onRestorePip: () => void;
  onToggleVideoFit: () => void;
  onToggleMinimize: () => void;
  onCycleMiniCorner: () => void;
  onToggleFullscreen: () => void;
}

export function CallStageView({
  windowRef,
  callType,
  callStatus,
  callTitle,
  avatarPeer,
  hasRoom,
  incoming,
  busy,
  error,
  reconnecting,
  elapsedSeconds,
  summaryAvailable,
  microphone,
  camera,
  canSwitchCamera,
  tracks,
  remotePeers,
  remoteVideoCount,
  hasLocalVideo,
  layout,
  effectiveSwapped,
  showHeroOverlay,
  canAutoHideChrome,
  chromeHidden,
  pipCorner,
  pipCollapsed,
  videoFit,
  isMinimized,
  miniCorner,
  isFullscreen,
  fullscreenSupported,
  onRevealChrome,
  onToggleStageChrome,
  onToggleMicrophone,
  onToggleCamera,
  onSwitchCamera,
  onAccept,
  onReject,
  onHangup,
  onRejoin,
  onToggleSwap,
  onCyclePipCorner,
  onCollapsePip,
  onRestorePip,
  onToggleVideoFit,
  onToggleMinimize,
  onCycleMiniCorner,
  onToggleFullscreen,
}: CallStageViewProps) {
  const isActiveCall = callStatus === 'active' && hasRoom;
  const statusSubtitle = reconnecting
    ? 'Mất mạng, đang kết nối lại…'
    : isActiveCall
      ? `${callType === 'video' ? 'Video' : 'Thoại'} · ${formatCallDuration(elapsedSeconds)}`
      : incoming
        ? `Cuộc gọi ${callType === 'video' ? 'video' : 'thoại'} đến…`
        : callStatus === 'ringing'
          ? 'Đang đổ chuông…'
          : 'Đang kết nối…';

  const remotePeerMutedAudio =
    remotePeers.length === 1 && remotePeers[0].audioMuted;
  const remotePeerCameraOff =
    callType === 'video' &&
    callStatus === 'active' &&
    remotePeers.length === 1 &&
    !remotePeers[0].hasVideo;

  const canSwapViews =
    layout === 'one-to-one' &&
    remoteVideoCount === 1 &&
    hasLocalVideo &&
    !pipCollapsed;

  function resolveTrackRole(item: MediaTrackItem): string {
    if (item.kind === 'audio') return 'is-audio';
    if (layout === 'grid') {
      return item.local ? 'is-pip' : 'is-grid-tile';
    }
    if (layout === 'solo-preview') {
      return 'is-solo-preview';
    }
    if (layout === 'one-to-one') {
      if (item.local) {
        if (effectiveSwapped) return 'is-primary';
        return pipCollapsed ? 'is-pip-hidden' : 'is-pip';
      }
      return effectiveSwapped ? 'is-pip' : 'is-primary';
    }
    return 'is-pip-hidden';
  }

  const gridCount = Math.max(1, remotePeers.length || remoteVideoCount);

  return (
    <div
      className={`call-overlay${isMinimized ? ` is-minimized mini-${miniCorner}` : ''}`}
      role="dialog"
      aria-modal={!isMinimized}
      aria-label={callTitle}
    >
      <section
        ref={windowRef}
        onMouseMove={!isMinimized ? onRevealChrome : undefined}
        onFocusCapture={!isMinimized ? onRevealChrome : undefined}
        className={[
          'call-window',
          hasRoom ? 'connected' : 'ringing',
          callType === 'video' ? 'video-mode' : 'audio-mode',
          remoteVideoCount > 0 ? 'has-remote-video' : '',
          chromeHidden && !isMinimized ? 'chrome-hidden' : '',
          isMinimized ? 'is-minimized' : '',
          isFullscreen ? 'is-fullscreen' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <header className="call-topbar">
          <div className="call-peer-pill">
            <span className="call-peer-avatar" aria-hidden="true">
              <Avatar peer={avatarPeer} />
            </span>
            <div className="call-peer-copy">
              <strong>{callTitle}</strong>
              <small>
                {reconnecting ? (
                  <WifiOff size={12} className="call-reconnecting-icon" />
                ) : isActiveCall ? (
                  <span className="call-live-dot" aria-hidden="true" />
                ) : (
                  <span className="call-ring-dot" aria-hidden="true" />
                )}
                <span className="call-status-text">{statusSubtitle}</span>
                {remotePeerMutedAudio && !isMinimized && (
                  <span
                    className="call-peer-muted-chip"
                    title="Đối phương đang tắt mic"
                  >
                    <MicOff size={11} />
                    <span>Tắt mic</span>
                  </span>
                )}
                {summaryAvailable && !isMinimized && (
                  <span
                    className="call-ai-chip"
                    title="Có thể dùng AI tóm tắt theo yêu cầu sau cuộc gọi"
                  >
                    <Sparkles size={11} />
                    <span>AI tóm tắt</span>
                  </span>
                )}
              </small>
            </div>
          </div>

          <div className="call-top-actions">
            {isMinimized ? (
              <>
                <button
                  type="button"
                  className="call-top-btn"
                  onClick={onCycleMiniCorner}
                  aria-label="Đổi góc cửa sổ thu nhỏ"
                  title="Đổi góc hiển thị"
                >
                  <CornerUpRight size={15} />
                </button>
                <button
                  type="button"
                  className="call-top-btn"
                  onClick={onToggleMinimize}
                  aria-label="Mở rộng cửa sổ cuộc gọi"
                  title="Mở rộng"
                >
                  <Maximize2 size={15} />
                </button>
              </>
            ) : (
              <>
                {callType === 'video' && remoteVideoCount > 0 && (
                  <button
                    type="button"
                    className={`call-top-btn with-label${videoFit === 'cover' ? ' is-active' : ''}`}
                    onClick={onToggleVideoFit}
                    aria-label={
                      videoFit === 'contain'
                        ? 'Lấp đầy khung hình video'
                        : 'Hiển thị vừa khung không cắt hình'
                    }
                    title={
                      videoFit === 'contain'
                        ? 'Chuyển sang lấp đầy khung hình'
                        : 'Chuyển sang vừa khung (không cắt hình)'
                    }
                  >
                    {videoFit === 'contain' ? (
                      <Expand size={15} />
                    ) : (
                      <Shrink size={15} />
                    )}
                    <span>
                      {videoFit === 'contain' ? 'Lấp đầy' : 'Vừa khung'}
                    </span>
                  </button>
                )}
                {!incoming && (
                  <button
                    type="button"
                    className="call-top-btn"
                    onClick={onToggleMinimize}
                    aria-label="Thu nhỏ cuộc gọi để vừa gọi vừa nhắn tin"
                    title="Thu nhỏ (vừa gọi vừa nhắn tin)"
                  >
                    <PictureInPicture2 size={16} />
                  </button>
                )}
                {fullscreenSupported && !incoming && (
                  <button
                    type="button"
                    className="call-top-btn"
                    onClick={onToggleFullscreen}
                    aria-label={
                      isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'
                    }
                    title={
                      isFullscreen
                        ? 'Thoát toàn màn hình (F)'
                        : 'Toàn màn hình (F)'
                    }
                  >
                    {isFullscreen ? (
                      <Minimize2 size={16} />
                    ) : (
                      <Maximize2 size={16} />
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </header>

        {error && !isMinimized && (
          <p className="message error call-inline-error">{error}</p>
        )}

        {hasRoom ? (
          <div
            className={[
              'call-stage',
              `layout-${layout}`,
              callType === 'audio' ? 'audio' : 'video',
              layout === 'one-to-one' ? 'one-to-one' : '',
              remoteVideoCount > 0 ? 'has-remote' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-grid-count={layout === 'grid' ? gridCount : undefined}
            onClick={() => {
              if (isMinimized) {
                onToggleMinimize();
                return;
              }
              if (canAutoHideChrome) onToggleStageChrome();
            }}
          >
            <div className="call-ambient-backdrop" aria-hidden="true" />

            {tracks.map((item) => (
              <AttachedTrack
                key={item.key}
                item={item}
                roleClass={resolveTrackRole(item)}
                pipCorner={pipCorner}
                videoFit={videoFit}
                canSwap={canSwapViews}
                isMinimized={isMinimized}
                onSwap={onToggleSwap}
                onCycleCorner={onCyclePipCorner}
                onCollapsePip={onCollapsePip}
              />
            ))}

            {layout === 'grid' &&
              remotePeers
                .filter((peer) => !peer.hasVideo)
                .map((peer) => (
                  <div
                    key={`placeholder:${peer.identity}`}
                    className={`call-grid-placeholder${peer.isSpeaking ? ' is-speaking' : ''}`}
                  >
                    <span className="call-grid-avatar" aria-hidden="true">
                      <Avatar peer={{ displayName: peer.name }} />
                    </span>
                    <strong className="call-grid-name">{peer.name}</strong>
                    <span className="call-grid-sub">
                      {peer.audioMuted
                        ? 'Đã tắt camera & mic'
                        : 'Đã tắt camera'}
                    </span>
                  </div>
                ))}

            {!isMinimized &&
              callType === 'video' &&
              layout === 'one-to-one' &&
              pipCollapsed &&
              hasLocalVideo && (
                <button
                  type="button"
                  className={`call-pip-restore corner-${pipCorner}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRestorePip();
                  }}
                  title="Hiện lại khung hình của bạn"
                >
                  <Eye size={14} />
                  <span>Hiện camera bạn</span>
                </button>
              )}

            {!isMinimized &&
              callType === 'video' &&
              !camera &&
              callStatus === 'active' &&
              remoteVideoCount > 0 && (
                <div
                  className={`call-local-off-pill corner-${pipCorner}`}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={onCyclePipCorner}
                  title="Camera của bạn đang tắt"
                >
                  <VideoOff size={13} />
                  <span>Camera bạn đang tắt</span>
                </div>
              )}

            {showHeroOverlay && (
              <div className="call-hero-center">
                <div
                  className={`call-avatar-pulse${callStatus === 'ringing' ? ' is-ringing' : ''}`}
                >
                  <span className="call-avatar-xl" aria-hidden="true">
                    <Avatar peer={avatarPeer} />
                  </span>
                </div>
                <strong className="call-hero-name">{callTitle}</strong>
                {!isMinimized && (
                  <span className="call-hero-status">
                    {reconnecting
                      ? 'Đang kết nối lại…'
                      : callStatus === 'ringing'
                        ? 'Đang chờ người nhận trả lời…'
                        : remotePeerCameraOff
                          ? `Đối phương đang tắt camera · ${formatCallDuration(elapsedSeconds)}`
                          : formatCallDuration(elapsedSeconds)}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div
            className="call-stage call-waiting-stage"
            onClick={isMinimized ? onToggleMinimize : undefined}
          >
            <div className="call-ambient-backdrop" aria-hidden="true" />
            <div className="call-hero-center">
              {!isMinimized && (
                <span className="call-mode-badge">
                  {callType === 'video' ? (
                    <Video size={13} />
                  ) : (
                    <Phone size={13} />
                  )}
                  <span>
                    {callType === 'video' ? 'CUỘC GỌI VIDEO' : 'CUỘC GỌI THOẠI'}
                  </span>
                </span>
              )}
              <div className="call-avatar-pulse is-ringing">
                <span className="call-avatar-xl" aria-hidden="true">
                  <Avatar peer={avatarPeer} />
                </span>
              </div>
              <strong className="call-hero-name">{callTitle}</strong>
              {!isMinimized && (
                <span className="call-hero-status">
                  {incoming
                    ? `Đang gọi ${callType === 'video' ? 'video' : 'thoại'} cho bạn…`
                    : 'Đang kết nối cuộc gọi…'}
                </span>
              )}
            </div>
          </div>
        )}

        <footer className="call-controls">
          <div className="call-controls-dock">
            {incoming ? (
              <>
                <div className="call-dock-item">
                  <button
                    type="button"
                    className="call-control reject"
                    disabled={busy}
                    onClick={onReject}
                    aria-label="Từ chối cuộc gọi"
                    title="Từ chối"
                  >
                    <PhoneOff size={24} />
                  </button>
                  <span className="call-dock-label">Từ chối</span>
                </div>
                <div className="call-dock-item">
                  <button
                    type="button"
                    className="call-control accept"
                    disabled={busy}
                    onClick={onAccept}
                    aria-label="Nhận cuộc gọi"
                    title="Nhận cuộc gọi"
                  >
                    {callType === 'video' ? (
                      <Video size={24} />
                    ) : (
                      <Phone size={24} />
                    )}
                  </button>
                  <span className="call-dock-label">Trả lời</span>
                </div>
              </>
            ) : (
              <>
                {!hasRoom && callStatus === 'active' && (
                  <button
                    type="button"
                    className="call-control accept rejoin"
                    disabled={busy}
                    onClick={onRejoin}
                  >
                    Tham gia lại
                  </button>
                )}

                <div className="call-dock-item">
                  <button
                    type="button"
                    className={`call-control${microphone ? '' : ' is-muted'}`}
                    disabled={!hasRoom || busy}
                    onClick={onToggleMicrophone}
                    aria-label={microphone ? 'Tắt mic' : 'Bật mic'}
                    title={microphone ? 'Tắt mic (M)' : 'Bật mic (M)'}
                  >
                    {microphone ? (
                      <Mic size={isMinimized ? 16 : 21} />
                    ) : (
                      <MicOff size={isMinimized ? 16 : 21} />
                    )}
                  </button>
                  {!isMinimized && (
                    <span className="call-dock-label">
                      {microphone ? 'Tắt mic' : 'Bật mic'}
                    </span>
                  )}
                </div>

                {callType === 'video' && (
                  <div className="call-dock-item">
                    <button
                      type="button"
                      className={`call-control${camera ? '' : ' is-muted'}`}
                      disabled={!hasRoom || busy}
                      onClick={onToggleCamera}
                      aria-label={camera ? 'Tắt camera' : 'Bật camera'}
                      title={camera ? 'Tắt camera (V)' : 'Bật camera (V)'}
                    >
                      {camera ? (
                        <Video size={isMinimized ? 16 : 21} />
                      ) : (
                        <VideoOff size={isMinimized ? 16 : 21} />
                      )}
                    </button>
                    {!isMinimized && (
                      <span className="call-dock-label">
                        {camera ? 'Tắt cam' : 'Bật cam'}
                      </span>
                    )}
                  </div>
                )}

                {!isMinimized &&
                  callType === 'video' &&
                  camera &&
                  canSwitchCamera && (
                    <div className="call-dock-item">
                      <button
                        type="button"
                        className="call-control"
                        disabled={!hasRoom || busy}
                        onClick={onSwitchCamera}
                        aria-label="Đổi camera"
                        title="Đổi camera trước/sau"
                      >
                        <SwitchCamera size={20} />
                      </button>
                      <span className="call-dock-label">Đổi cam</span>
                    </div>
                  )}

                {isMinimized && (
                  <div className="call-dock-item">
                    <button
                      type="button"
                      className="call-control"
                      onClick={onToggleMinimize}
                      aria-label="Mở rộng cuộc gọi"
                      title="Mở rộng cuộc gọi"
                    >
                      <Maximize2 size={16} />
                    </button>
                  </div>
                )}

                <div className="call-dock-item">
                  <button
                    type="button"
                    className="call-control reject"
                    disabled={busy}
                    onClick={onHangup}
                    aria-label="Kết thúc cuộc gọi"
                    title="Kết thúc"
                  >
                    <PhoneOff size={isMinimized ? 16 : 21} />
                  </button>
                  {!isMinimized && (
                    <span className="call-dock-label">Kết thúc</span>
                  )}
                </div>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
