import { API_ORIGIN } from './api';
export function Avatar({
  peer,
}: {
  peer: { displayName: string; avatarUrl?: string | null };
}) {
  return peer.avatarUrl?.startsWith('/users/avatars/') ? (
    <img
      className="avatar-image"
      src={`${API_ORIGIN}/api/v1${peer.avatarUrl}`}
      alt=""
    />
  ) : (
    <>{Array.from(peer.displayName)[0]?.toUpperCase()}</>
  );
}
