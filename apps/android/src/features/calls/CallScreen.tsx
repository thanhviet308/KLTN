import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
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

function Action({
  label,
  onPress,
  disabled,
  danger,
  selected,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        danger && s.danger,
        selected && s.selected,
        (pressed || disabled) && s.dim,
      ]}
    >
      <Text style={s.actionText}>{label}</Text>
    </Pressable>
  );
}

function MediaControls({ room, video }: { room: Room; video: boolean }) {
  const [mic, setMic] = useState(room.localParticipant.isMicrophoneEnabled);
  const [camera, setCamera] = useState(room.localParticipant.isCameraEnabled);
  const [speaker, setSpeaker] = useState(video);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
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
    setError('');
    try {
      await work();
    } catch {
      setError('Không thể thay đổi thiết bị. Hãy kiểm tra quyền micro/camera.');
    } finally {
      setWorking(false);
    }
  }
  return (
    <>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <View style={s.controls}>
        <Action
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
          <Action
            label={camera ? 'Tắt camera' : 'Bật camera'}
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
        <Action
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
      </View>
    </>
  );
}

function Videos() {
  const tracks = useTracks([Track.Source.Camera]);
  return (
    <View style={s.videos}>
      {tracks.filter(isTrackReference).map(track => (
        <View
          key={`${track.participant.identity}:${track.source}`}
          style={[s.videoTile, track.participant.isLocal && s.localTile]}
        >
          <VideoTrack trackRef={track} style={s.video} />
          <Text style={s.videoLabel}>
            {track.participant.isLocal ? 'Bạn' : 'Người tham gia'}
          </Text>
        </View>
      ))}
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
  useEffect(() => {
    if (!call || !isOpen(call)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [call]);
  const open = !!call && isOpen(call);
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
      : incoming
        ? 'Cuộc gọi đến'
        : connection === ConnectionState.Reconnecting ||
            connection === ConnectionState.SignalReconnecting
          ? 'Mất mạng, đang kết nối lại…'
          : call.status === 'ringing'
            ? 'Đang đổ chuông…'
            : room
              ? duration
              : 'Sẵn sàng kết nối';
  return (
    <Modal
      visible={!!call || !!error || busy}
      animationType="slide"
      onRequestClose={open ? () => {} : onDismiss}
    >
      <View
        style={[
          s.screen,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20 },
        ]}
      >
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.eyebrow}>
            PINGPONG · {call?.type === 'video' ? 'GỌI VIDEO' : 'GỌI THOẠI'}
          </Text>
          <Text style={s.title}>{title}</Text>
          <Text accessibilityLiveRegion="polite" style={s.status}>
            {status}
          </Text>
          {!room && (
            <View style={s.avatar}>
              <Text style={s.avatarText}>
                {title.trim().slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          {room && (
            <RoomContext.Provider value={room}>
              {call?.type === 'video' && <Videos />}
              <MediaControls room={room} video={call?.type === 'video'} />
            </RoomContext.Provider>
          )}
          {busy && <ActivityIndicator color="#d9ee98" size="large" />}
          {!!error && (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          )}
        </ScrollView>
        <View style={s.controls}>
          {open ? (
            <>
              {!room && (
                <Action
                  label={incoming ? 'Trả lời' : 'Kết nối lại'}
                  disabled={busy}
                  onPress={onJoin}
                />
              )}
              <Action
                label={incoming ? 'Từ chối' : 'Kết thúc'}
                danger
                disabled={busy}
                onPress={onHangup}
              />
            </>
          ) : (
            <Action label="Đóng" disabled={busy} onPress={onDismiss} />
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#123d38', paddingHorizontal: 20 },
  content: { flexGrow: 1, alignItems: 'center', gap: 20, paddingBottom: 24 },
  eyebrow: {
    color: '#c3d8d2',
    fontSize: 12,
    letterSpacing: 2,
    textAlign: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  status: { color: '#d9ee98', fontSize: 16, textAlign: 'center' },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#286057',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 28,
  },
  avatarText: { color: '#d9ee98', fontSize: 48, fontWeight: '700' },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
  },
  action: {
    minHeight: 48,
    minWidth: 88,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: '#286057',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  danger: { backgroundColor: '#b83747' },
  selected: { backgroundColor: '#51685f' },
  dim: { opacity: 0.5 },
  error: {
    color: '#ffd4d8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  videos: { width: '100%', gap: 12 },
  videoTile: {
    height: 300,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#0a2925',
  },
  localTile: { height: 150, width: '45%', alignSelf: 'flex-end' },
  video: { flex: 1 },
  videoLabel: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    color: '#fff',
    backgroundColor: '#0009',
    padding: 4,
    borderRadius: 4,
  },
});
