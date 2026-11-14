import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  RoomContext,
  VideoTrack,
  isTrackReference,
  useTracks,
} from '@livekit/react-native';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isOpen, type Call } from './call-model';

const statusLabels: Record<Call['status'], string> = {
  ringing: 'Đang đổ chuông…',
  active: 'Đang gọi',
  ended: 'Cuộc gọi đã kết thúc',
  rejected: 'Cuộc gọi đã bị từ chối',
  missed: 'Không có người trả lời',
  cancelled: 'Cuộc gọi đã hủy',
};

type Corner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
const CORNERS: Corner[] = [
  'top-right',
  'bottom-right',
  'bottom-left',
  'top-left',
];

function DockButton({
  icon,
  label,
  onPress,
  disabled,
  danger,
  accept,
  selected,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  accept?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.dockItem, (pressed || disabled) && s.dim]}
    >
      <View
        style={[
          s.circleBtn,
          selected && s.circleBtnSelected,
          accept && s.circleBtnAccept,
          danger && s.circleBtnDanger,
        ]}
      >
        <Text
          style={[
            s.circleBtnIcon,
            selected && !danger && !accept && s.circleBtnIconSelected,
          ]}
        >
          {icon}
        </Text>
      </View>
      <Text numberOfLines={1} style={s.dockLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function MediaControls({
  room,
  video,
  onError,
}: {
  room: Room;
  video: boolean;
  onError: (message: string) => void;
}) {
  const [mic, setMic] = useState(room.localParticipant.isMicrophoneEnabled);
  const [camera, setCamera] = useState(room.localParticipant.isCameraEnabled);
  const [speaker, setSpeaker] = useState(video);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const sync = () => {
      setMic(room.localParticipant.isMicrophoneEnabled);
      setCamera(room.localParticipant.isCameraEnabled);
    };
    room.on(RoomEvent.TrackMuted, sync).on(RoomEvent.TrackUnmuted, sync);
    return () => {
      room.off(RoomEvent.TrackMuted, sync).off(RoomEvent.TrackUnmuted, sync);
    };
  }, [room]);

  async function change(work: () => Promise<void>) {
    if (working) return;
    setWorking(true);
    onError('');
    try {
      await work();
    } catch {
      onError('Không thể thay đổi thiết bị. Hãy kiểm tra quyền micro/camera.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <DockButton
        icon={mic ? '🎙' : '🔇'}
        label={mic ? 'Tắt mic' : 'Bật mic'}
        selected={!mic}
        disabled={working}
        onPress={() => {
          void change(async () => {
            await room.localParticipant.setMicrophoneEnabled(!mic);
            setMic(!mic);
          });
        }}
      />
      {video && (
        <DockButton
          icon={camera ? '📹' : '🚫'}
          label={camera ? 'Tắt cam' : 'Bật cam'}
          selected={!camera}
          disabled={working}
          onPress={() => {
            void change(async () => {
              await room.localParticipant.setCameraEnabled(!camera);
              setCamera(!camera);
            });
          }}
        />
      )}
      <DockButton
        icon={speaker ? '🔊' : '🔈'}
        label={speaker ? 'Loa ngoài' : 'Loa trong'}
        selected={speaker}
        disabled={working}
        onPress={() => {
          void change(async () => {
            const { AudioSession } = await import('@livekit/react-native');
            await AudioSession.selectAudioOutput(
              speaker ? 'earpiece' : 'speaker',
            );
            setSpeaker(!speaker);
          });
        }}
      />
    </>
  );
}

function VideoStage({
  title,
  topOffset,
  bottomOffset,
}: {
  title: string;
  topOffset: number;
  bottomOffset: number;
}) {
  const tracks = useTracks([Track.Source.Camera]).filter(isTrackReference);
  const localTrack = tracks.find(t => t.participant.isLocal);
  const remoteTracks = tracks.filter(t => !t.participant.isLocal);
  const [cornerIdx, setCornerIdx] = useState(0);
  const corner = CORNERS[cornerIdx % CORNERS.length];

  const pipPosition = {
    top: corner.startsWith('top') ? topOffset : undefined,
    bottom: corner.startsWith('bottom') ? bottomOffset : undefined,
    right: corner.endsWith('right') ? 16 : undefined,
    left: corner.endsWith('left') ? 16 : undefined,
  };

  return (
    <View style={s.stage}>
      {remoteTracks.length === 0 ? (
        <View style={s.waitingStage}>
          <View style={s.avatarLarge}>
            <Text style={s.avatarLargeText}>
              {title.trim().slice(0, 1).toUpperCase() || 'P'}
            </Text>
          </View>
          <Text style={s.waitingHint}>Đang chờ hình ảnh từ đối phương…</Text>
        </View>
      ) : remoteTracks.length === 1 ? (
        <VideoTrack trackRef={remoteTracks[0]} style={s.remoteFullVideo} />
      ) : (
        <View
          style={[
            s.groupGrid,
            { paddingTop: topOffset, paddingBottom: bottomOffset },
          ]}
        >
          {remoteTracks.map(track => (
            <View
              key={`${track.participant.identity}:${track.source}`}
              style={s.groupTile}
            >
              <VideoTrack trackRef={track} style={s.remoteFullVideo} />
              <View style={s.tileBadge}>
                <Text numberOfLines={1} style={s.tileBadgeText}>
                  {track.participant.name || 'Thành viên'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {localTrack && (
        <Pressable
          accessibilityHint="Chạm để đổi góc hiển thị camera của bạn"
          accessibilityLabel="Camera của bạn, chạm để đổi góc"
          onPress={() => setCornerIdx(prev => (prev + 1) % CORNERS.length)}
          style={[s.pipTile, pipPosition]}
        >
          <VideoTrack trackRef={localTrack} style={s.pipVideo} />
          <View style={s.pipBadge}>
            <Text style={s.pipBadgeText}>Bạn · Đổi góc</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

export function CallScreen({
  call,
  room,
  title,
  incoming,
  busy,
  connection,
  error,
  onJoin,
  onHangup,
  onDismiss,
}: {
  call?: Call;
  room?: Room;
  title: string;
  incoming: boolean;
  busy: boolean;
  connection: ConnectionState;
  error: string;
  onJoin: () => void;
  onHangup: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(Date.now());
  const [deviceError, setDeviceError] = useState('');

  useEffect(() => {
    if (!call || !isOpen(call)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [call]);

  const open = !!call && isOpen(call);
  const isVideo = call?.type === 'video';
  const elapsed = call?.startedAt
    ? Math.max(0, Math.floor((now - Date.parse(call.startedAt)) / 1000))
    : 0;
  const duration = `${Math.floor(elapsed / 60)
    .toString()
    .padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;

  const status = !call
    ? busy
      ? 'Đang chuẩn bị cuộc gọi…'
      : 'Không thể bắt đầu cuộc gọi'
    : !open
      ? statusLabels[call.status]
      : incoming && !room
        ? 'Cuộc gọi đến…'
        : connection === ConnectionState.Reconnecting ||
            connection === ConnectionState.SignalReconnecting
          ? 'Mất mạng, đang kết nối lại…'
          : call.status === 'ringing'
            ? 'Đang đổ chuông…'
            : room
              ? duration
              : 'Đang kết nối…';

  const combinedError = error || deviceError;

  return (
    <Modal
      visible={!!call || !!error || busy}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={open ? () => {} : onDismiss}
    >
      <View style={s.screen}>
        {room ? (
          <RoomContext.Provider value={room}>
            {isVideo ? (
              <VideoStage
                title={title}
                topOffset={insets.top + 82}
                bottomOffset={insets.bottom + 128}
              />
            ) : (
              <View style={s.audioStage}>
                <View style={s.avatarPulseRing}>
                  <View style={s.avatarLarge}>
                    <Text style={s.avatarLargeText}>
                      {title.trim().slice(0, 1).toUpperCase() || 'P'}
                    </Text>
                  </View>
                </View>
                <Text numberOfLines={2} style={s.stageTitle}>
                  {title}
                </Text>
                <Text accessibilityLiveRegion="polite" style={s.stageStatus}>
                  {status}
                </Text>
              </View>
            )}

            <View style={[s.topBar, { top: insets.top + 12 }]}>
              <View style={s.topPill}>
                <View style={s.liveDot} />
                <Text numberOfLines={1} style={s.topTitle}>
                  {title}
                </Text>
                <Text style={s.topStatus}>· {status}</Text>
              </View>
            </View>

            {!!combinedError && (
              <View style={[s.errorBanner, { bottom: insets.bottom + 122 }]}>
                <Text accessibilityRole="alert" style={s.errorText}>
                  {combinedError}
                </Text>
              </View>
            )}

            <View
              style={[
                s.bottomDockWrap,
                { paddingBottom: Math.max(insets.bottom + 14, 22) },
              ]}
            >
              <View style={s.bottomDock}>
                <MediaControls
                  room={room}
                  video={isVideo}
                  onError={setDeviceError}
                />
                <DockButton
                  icon="✕"
                  label="Kết thúc"
                  danger
                  disabled={busy}
                  onPress={onHangup}
                />
              </View>
            </View>
          </RoomContext.Provider>
        ) : (
          <View
            style={[
              s.preCallContainer,
              {
                paddingTop: insets.top + 36,
                paddingBottom: Math.max(insets.bottom + 24, 32),
              },
            ]}
          >
            <View style={s.preCallTop}>
              <View style={s.callTypeBadge}>
                <Text style={s.callTypeBadgeText}>
                  {isVideo ? '📹 CUỘC GỌI VIDEO' : '📞 CUỘC GỌI THOẠI'}
                </Text>
              </View>
              <View style={s.avatarPulseRing}>
                <View style={s.avatarLarge}>
                  <Text style={s.avatarLargeText}>
                    {title.trim().slice(0, 1).toUpperCase() || 'P'}
                  </Text>
                </View>
              </View>
              <Text numberOfLines={2} style={s.stageTitle}>
                {title}
              </Text>
              <Text accessibilityLiveRegion="polite" style={s.stageStatus}>
                {status}
              </Text>
              {busy && (
                <ActivityIndicator
                  color="#f3d2b8"
                  size="large"
                  style={{ marginTop: 14 }}
                />
              )}
              {!!combinedError && (
                <View style={s.inlineErrorCard}>
                  <Text accessibilityRole="alert" style={s.errorText}>
                    {combinedError}
                  </Text>
                </View>
              )}
            </View>

            <View style={s.bottomDock}>
              {open ? (
                <>
                  <DockButton
                    icon="📞"
                    label={incoming ? 'Trả lời' : 'Kết nối'}
                    accept
                    disabled={busy}
                    onPress={onJoin}
                  />
                  <DockButton
                    icon="✕"
                    label={incoming ? 'Từ chối' : 'Kết thúc'}
                    danger
                    disabled={busy}
                    onPress={onHangup}
                  />
                </>
              ) : (
                <DockButton
                  icon="✕"
                  label="Đóng"
                  disabled={busy}
                  onPress={onDismiss}
                />
              )}
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0b0d13',
  },
  stage: {
    flex: 1,
    backgroundColor: '#0b0d13',
  },
  remoteFullVideo: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  waitingStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 16,
  },
  waitingHint: {
    color: '#c4b8ad',
    fontSize: 14,
    textAlign: 'center',
  },
  groupGrid: {
    flex: 1,
    paddingHorizontal: 12,
    gap: 10,
    justifyContent: 'center',
  },
  groupTile: {
    flex: 1,
    minHeight: 160,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#181b24',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  tileBadge: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  tileBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  pipTile: {
    position: 'absolute',
    width: 108,
    height: 148,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#1f2330',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.28)',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.38,
    shadowRadius: 8,
  },
  pipVideo: {
    flex: 1,
  },
  pipBadge: {
    position: 'absolute',
    bottom: 6,
    alignSelf: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  pipBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  topPill: {
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: 'rgba(18, 20, 28, 0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  topTitle: {
    flexShrink: 1,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  topStatus: {
    color: '#f3d2b8',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  audioStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  preCallContainer: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  preCallTop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    width: '100%',
  },
  callTypeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(183, 80, 32, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(243, 210, 184, 0.25)',
    marginBottom: 8,
  },
  callTypeBadgeText: {
    color: '#f3d2b8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  avatarPulseRing: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: 'rgba(183, 80, 32, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(243, 210, 184, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  avatarLarge: {
    width: 106,
    height: 106,
    borderRadius: 53,
    backgroundColor: '#b75020',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLargeText: {
    color: '#ffffff',
    fontSize: 44,
    fontWeight: '800',
  },
  stageTitle: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 4,
  },
  stageStatus: {
    color: '#f3d2b8',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  bottomDockWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
    alignItems: 'center',
  },
  bottomDock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 34,
    backgroundColor: 'rgba(22, 24, 34, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  dockItem: {
    alignItems: 'center',
    gap: 6,
    minWidth: 58,
  },
  circleBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleBtnSelected: {
    backgroundColor: '#ffffff',
  },
  circleBtnAccept: {
    backgroundColor: '#1f9d63',
  },
  circleBtnDanger: {
    backgroundColor: '#dc2626',
  },
  circleBtnIcon: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
  },
  circleBtnIconSelected: {
    color: '#111827',
  },
  dockLabel: {
    color: '#e5e7eb',
    fontSize: 11,
    fontWeight: '600',
  },
  dim: {
    opacity: 0.5,
  },
  errorBanner: {
    position: 'absolute',
    left: 20,
    right: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(185, 28, 28, 0.88)',
  },
  inlineErrorCard: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(185, 28, 28, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(252, 165, 165, 0.4)',
  },
  errorText: {
    color: '#fee2e2',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});
