import { useEffect, useRef, useState } from 'react';
import { Music2, Pause, Play, Plus, Search, Trash2, X } from 'lucide-react';
import * as api from '../../lib/api';
import { Avatar } from '../../components/Avatar';
import {
  presenceBadge,
  presenceLabel,
  type Presence,
} from '../../hooks/usePresence';
import type { Peer } from '../../lib/types';

export interface FriendNote {
  user: Peer;
  body: string;
  musicTitle: string | null;
  musicArtist: string | null;
  musicUrl: string | null;
  musicPreviewUrl: string | null;
  updatedAt: string;
  expiresAt: string;
}

interface MusicCatalogTrack {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  previewUrl: string | null;
  trackUrl: string | null;
}

const DEFAULT_TRENDING_TRACKS: MusicCatalogTrack[] = [
  {
    id: '1723659102',
    title: 'Ahhhhhh',
    artist: 'The Milkers',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/38/e5/3c/38e53c9e-1c57-283f-6af5-01e2aff23f74/artwork.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview116/v4/54/55/2a/54552a95-7d8e-4a3f-2054-f0523186ebf8/mzaf_6493960283559211099.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/ahhhhhh/1723659101?i=1723659102&uo=4',
  },
  {
    id: '1860957407',
    title: 'Anh Vẫn Ở Đây',
    artist: 'Quang Đăng Trần, Viam',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/3f/18/cf/3f18cf91-92ed-1acf-7d9a-d74d6f755134/3617397778343.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/33/59/02/33590284-24bd-b40b-802f-e2420479c24d/mzaf_10405882291671365677.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/anh-va-n-o-%C4%91a-y/1860957163?i=1860957407&uo=4',
  },
  {
    id: '1818980404',
    title: 'Sập Nguồn',
    artist: 'Audition Cảm Xúc',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/de/01/49/de01495a-ec0b-8cdb-dea9-88ae23030b5c/859706463462_cover.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/79/6b/50/796b5061-b69c-92d6-77c7-ce17b32d4112/mzaf_14906074946391514430.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/s%E1%BA%ADp-ngu%E1%BB%93n/1818980399?i=1818980404&uo=4',
  },
  {
    id: '6802787171',
    title: 'Ác Mộng Đẹp',
    artist: 'Đạt G',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/11/27/e9/1127e912-862b-98c3-abbd-6617f9d22358/823375379058_Cover.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/02/36/84/023684e0-4c38-25f2-6364-efc4f42f9a08/mzaf_3373388369120035802.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/%C3%A1c-m%E1%BB%99ng-%C4%91%E1%BA%B9p/6802786999?i=6802787171&uo=4',
  },
  {
    id: '6827404203',
    title: 'Như Một Người Rưng',
    artist: 'OSAD, Hà An Huy',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/99/2a/fa/992afa04-272d-b2b2-b6ca-9cc06f2c94dc/196874938225.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/f9/bd/a9/f9bda98b-b6b5-bfef-1dcb-bb51e3c59921/mzaf_2290608759897843218.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/nh%C6%B0-m%E1%BB%99t-ng%C6%B0%E1%BB%9Di-r%C6%B0ng/6827404200?i=6827404203&uo=4',
  },
  {
    id: '1886108103',
    title: 'TA SẼ ỔN THÔI',
    artist: 'FuQuan',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/67/6f/99/676f99cd-58fd-b457-51f9-5f4c855357bf/3617663805865.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/16/22/2b/16222b19-190d-2afe-d954-726513bb43bb/mzaf_5138121285127671061.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/ta-s%E1%BA%BD-%E1%BB%95n-th%C3%B4i/1886108097?i=1886108103&uo=4',
  },
  {
    id: '6767713202',
    title: 'Nghĩ Nhiều',
    artist: 'hqhuy, 1nG, OMD',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/29/1f/99/291f9995-aeb7-e408-e5ac-72b557896936/7316481403647.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/ad/f8/bf/adf8bf0e-53ec-cdde-33ce-7f9e4582f750/mzaf_11736423424081931435.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/ngh%C4%A9-nhi%E1%BB%81u/6767713201?i=6767713202&uo=4',
  },
  {
    id: '1692142668',
    title: '20%',
    artist: 'iwamizu',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/41/52/9f/41529fbf-9def-206b-3b45-1090043eb2f4/859759827471_cover.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview116/v4/4e/67/ee/4e67eeb8-8bb3-20c2-5edb-cf661f8e5a15/mzaf_1258477481009377310.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/20/1692142440?i=1692142668&uo=4',
  },
  {
    id: '6786655030',
    title: 'Mơ Về Em',
    artist: 'MONO, EmceeDan',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/9d/42/dd/9d42dd80-eafb-1fc6-93ff-6d2720618e4a/26UMGIM86119.rgb.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/c0/15/ba/c015ba4c-3e87-aa96-4f72-06033ce2d7a1/mzaf_10894246610291870378.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/m%C6%A1-v%E1%BB%81-em/6786655002?i=6786655030&uo=4',
  },
  {
    id: '1638255334',
    title: 'Waiting For You',
    artist: 'MONO, Onionn',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/42/b6/13/42b6139f-7e7a-c801-9823-f48522ad002e/22UMGIM86209.rgb.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/41/de/66/41de66a0-843f-e28e-2e0e-70ebb456d1b1/mzaf_1737848243554449634.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/waiting-for-you/1638255074?i=1638255334&uo=4',
  },
  {
    id: '1728886495',
    title: 'Không Thể Say',
    artist: 'HIEUTHUHAI',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/9a/80/e5/9a80e53a-197d-6d4d-2799-ac0a68427d12/602458735987_Cover.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/65/61/6e/65616ef9-10ba-645c-0c7c-f2752cf993da/mzaf_17801968361475888022.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/kh%C3%B4ng-th%E1%BB%83-say/1728885950?i=1728886495&uo=4',
  },
  {
    id: '1712281414',
    title: 'Từng Quen',
    artist: 'Wren Evans, itsnk',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/cb/42/10/cb421004-d27a-6c08-a542-fa2e7ac3bb58/23UM1IM21988.rgb.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/52/88/30/5288308e-b8b0-f2c5-5c67-71b6a9b444b3/mzaf_10392631813891460655.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/t%E1%BB%ABng-quen/1712281410?i=1712281414&uo=4',
  },
  {
    id: '1819021990',
    title: 'nếu lúc đó',
    artist: 'tlinh, 2pillz',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/ff/17/ec/ff17ec15-efc2-060b-dddd-a4eae2430270/00602455486226_Cover.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/ca/3e/21/ca3e2150-32e6-08b2-7c1e-ea661353c13a/mzaf_14706742379720393686.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/n%E1%BA%BFu-l%C3%BAc-%C4%91%C3%B3/1819021988?i=1819021990&uo=4',
  },
  {
    id: '1637038497',
    title: 'Có Em',
    artist: 'Madihu, Low G.',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/5e/69/3e/5e693e0b-7b45-8fb2-baca-afeb6b5b8d23/5054197277016.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview112/v4/c9/a3/7a/c9a37aaf-6bed-f3e2-bf48-90142c097d75/mzaf_905368207526008338.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/c%C3%B3-em/1637038489?i=1637038497&uo=4',
  },
  {
    id: '1492254775',
    title: 'Lạ Lùng',
    artist: 'Vũ.',
    artworkUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Music113/v4/69/60/4d/69604d44-d64b-a140-2baa-8afff0c4d4d5/190295287191.jpg/100x100bb.jpg',
    previewUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/26/b7/01/26b701f9-c650-c01b-0c85-46f683aa0025/mzaf_3844546848866349483.plus.aac.p.m4a',
    trackUrl:
      'https://music.apple.com/vn/album/l%E1%BA%A1-l%C3%B9ng/1492254773?i=1492254775&uo=4',
  },
];

function NoteComposer({
  current,
  busy,
  onClose,
  onSaved,
  onDeleted,
}: {
  current?: FriendNote;
  busy: boolean;
  onClose: () => void;
  onSaved: (note: FriendNote) => void;
  onDeleted: () => void;
}) {
  const [body, setBody] = useState(current?.body ?? '');
  const [music, setMusic] = useState(!!current?.musicTitle);
  const [title, setTitle] = useState(current?.musicTitle ?? '');
  const [artist, setArtist] = useState(current?.musicArtist ?? '');
  const [url, setUrl] = useState(current?.musicUrl ?? '');
  const [preview, setPreview] = useState(current?.musicPreviewUrl ?? '');
  const [artwork, setArtwork] = useState<string | null>(() => {
    if (!current?.musicTitle) return null;
    const match = DEFAULT_TRENDING_TRACKS.find(
      (t) => t.title.toLowerCase() === current.musicTitle?.toLowerCase(),
    );
    return match?.artworkUrl ?? null;
  });
  const [pickingMusic, setPickingMusic] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tracks, setTracks] = useState<MusicCatalogTrack[]>(
    DEFAULT_TRENDING_TRACKS,
  );
  const [searching, setSearching] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickingMusic) {
      dialog.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pickingMusic) {
          previewAudioRef.current?.pause();
          setPreviewingId(null);
          setPickingMusic(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [onClose, pickingMusic]);

  useEffect(() => {
    return () => {
      previewAudioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!pickingMusic) return;
    const q = searchQuery.trim();
    if (!q) {
      setTracks(DEFAULT_TRENDING_TRACKS);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.authenticated<{ items: MusicCatalogTrack[] }>(
          `/notes/music/search?q=${encodeURIComponent(q)}`,
        );
        if (!cancelled && res.items.length > 0) {
          setTracks(res.items);
          setSearching(false);
          return;
        }
      } catch {
        // Fallback to direct iTunes search below
      }
      try {
        const resp = await fetch(
          `https://itunes.apple.com/search?media=music&entity=song&country=VN&limit=20&term=${encodeURIComponent(q)}`,
        );
        if (resp.ok) {
          const data = (await resp.json()) as {
            results?: Array<{
              trackId?: number;
              trackName?: string;
              artistName?: string;
              artworkUrl100?: string;
              previewUrl?: string;
              trackViewUrl?: string;
            }>;
          };
          if (!cancelled) {
            const mapped: MusicCatalogTrack[] = (data.results ?? [])
              .filter((item) => item.trackName)
              .map((item) => ({
                id: String(
                  item.trackId ?? `${item.trackName}-${item.artistName}`,
                ),
                title: String(item.trackName ?? '').slice(0, 120),
                artist: String(item.artistName ?? '').slice(0, 120),
                artworkUrl: item.artworkUrl100 ?? null,
                previewUrl: item.previewUrl ?? null,
                trackUrl: item.trackViewUrl ?? null,
              }));
            setTracks(mapped);
          }
        }
      } catch {
        if (!cancelled) {
          const lower = q.toLowerCase();
          setTracks(
            DEFAULT_TRENDING_TRACKS.filter(
              (t) =>
                t.title.toLowerCase().includes(lower) ||
                t.artist.toLowerCase().includes(lower),
            ),
          );
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pickingMusic, searchQuery]);

  function toggleTrackPreview(track: MusicCatalogTrack) {
    if (!track.previewUrl) return;
    if (previewingId === track.id) {
      previewAudioRef.current?.pause();
      setPreviewingId(null);
      return;
    }
    previewAudioRef.current?.pause();
    const next = new Audio(track.previewUrl);
    previewAudioRef.current = next;
    next.addEventListener('ended', () => setPreviewingId(null), { once: true });
    void next
      .play()
      .then(() => setPreviewingId(track.id))
      .catch(() => setPreviewingId(null));
  }

  function handleSelectTrack(track: MusicCatalogTrack) {
    previewAudioRef.current?.pause();
    setPreviewingId(null);
    setMusic(true);
    setTitle(track.title);
    setArtist(track.artist);
    setUrl(track.trackUrl ?? '');
    setPreview(track.previewUrl ?? '');
    setArtwork(track.artworkUrl ?? null);
    setPickingMusic(false);
  }

  function handleClearMusic() {
    previewAudioRef.current?.pause();
    setPreviewingId(null);
    setMusic(false);
    setTitle('');
    setArtist('');
    setUrl('');
    setPreview('');
    setArtwork(null);
  }

  async function save() {
    if (!body.trim()) return setError('Hãy viết một ghi chú ngắn.');
    if (music && !title.trim()) return setError('Hãy chọn một bài hát.');
    previewAudioRef.current?.pause();
    setSaving(true);
    setError('');
    try {
      const result = await api.authenticated<{ note: FriendNote }>(
        '/notes/me',
        {
          body: body.trim(),
          ...(music && title.trim()
            ? {
                musicTitle: title.trim(),
                musicArtist: artist.trim() || undefined,
                musicUrl: url.trim() || undefined,
                musicPreviewUrl: preview.trim() || undefined,
              }
            : {}),
        },
        'PUT',
      );
      onSaved(result.note);
    } catch (failure) {
      setError(api.errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    previewAudioRef.current?.pause();
    setSaving(true);
    try {
      await api.authenticated('/notes/me', undefined, 'DELETE');
      onDeleted();
    } catch (failure) {
      setError(api.errorMessage(failure));
      setSaving(false);
    }
  }
  return (
    <div
      className="note-composer-scrim"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`note-composer${pickingMusic ? ' is-picking-music' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="note-composer-title"
        ref={dialog}
      >
        {pickingMusic ? (
          <div className="note-music-picker">
            <div className="note-music-picker-header">
              <div className="note-music-search-box">
                <Search className="note-music-search-icon" aria-hidden="true" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm kiếm nhạc"
                  aria-label="Tìm kiếm nhạc"
                  autoFocus
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="note-music-search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label="Xóa từ khóa"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="note-music-cancel-btn"
                onClick={() => {
                  previewAudioRef.current?.pause();
                  setPreviewingId(null);
                  setPickingMusic(false);
                }}
              >
                Hủy
              </button>
            </div>

            <div className="note-music-picker-list" role="listbox">
              {searching && (
                <p className="note-music-picker-status">Đang tìm bài hát…</p>
              )}
              {!searching && tracks.length === 0 && (
                <p className="note-music-picker-status">
                  Không tìm thấy bài hát phù hợp. Hãy thử từ khóa khác.
                </p>
              )}
              {tracks.map((track) => {
                const isPlaying = previewingId === track.id;
                return (
                  <div
                    key={track.id}
                    className={`note-music-track-row${
                      isPlaying ? ' is-playing' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="note-music-track-select"
                      onClick={() => handleSelectTrack(track)}
                    >
                      <span className="note-music-track-art">
                        {track.artworkUrl ? (
                          <img
                            src={track.artworkUrl}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <Music2 aria-hidden="true" />
                        )}
                      </span>
                      <span className="note-music-track-info">
                        <strong>{track.title}</strong>
                        <small>{track.artist}</small>
                      </span>
                    </button>
                    {track.previewUrl && (
                      <button
                        type="button"
                        className={`note-music-track-play${
                          isPlaying ? ' is-active' : ''
                        }`}
                        aria-label={
                          isPlaying
                            ? `Tạm dừng ${track.title}`
                            : `Nghe thử ${track.title}`
                        }
                        onClick={() => toggleTrackPreview(track)}
                      >
                        {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            <header>
              <div>
                <span className="note-kicker">GHI CHÚ 24 GIỜ</span>
                <h3 id="note-composer-title">Bạn đang nghĩ gì?</h3>
              </div>
              <button
                type="button"
                className="note-icon-button"
                aria-label="Đóng"
                onClick={onClose}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <label className="note-field">
              <span>Nội dung</span>
              <textarea
                maxLength={80}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Chia sẻ một điều ngắn gọn…"
              />
              <small>{body.length}/80</small>
            </label>

            {music && title ? (
              <div className="note-selected-song">
                <span className="note-selected-song-art">
                  {artwork ? (
                    <img src={artwork} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <Music2 aria-hidden="true" />
                  )}
                </span>
                <div className="note-selected-song-meta">
                  <strong>{title}</strong>
                  <small>{artist || 'Bài hát đính kèm'}</small>
                </div>
                <div className="note-selected-song-actions">
                  {preview && (
                    <button
                      type="button"
                      className="note-selected-song-play"
                      onClick={() =>
                        toggleTrackPreview({
                          id: 'selected-song',
                          title,
                          artist,
                          artworkUrl: artwork,
                          previewUrl: preview,
                          trackUrl: url,
                        })
                      }
                      aria-label={
                        previewingId === 'selected-song'
                          ? 'Tạm dừng nghe thử'
                          : 'Nghe thử bài đã chọn'
                      }
                    >
                      {previewingId === 'selected-song' ? (
                        <Pause size={15} />
                      ) : (
                        <Play size={15} />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    className="note-selected-song-change"
                    onClick={() => setPickingMusic(true)}
                  >
                    Đổi bài
                  </button>
                  <button
                    type="button"
                    className="note-selected-song-remove"
                    onClick={handleClearMusic}
                    aria-label="Gỡ bài hát"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="note-music-toggle"
                onClick={() => setPickingMusic(true)}
              >
                <Music2 aria-hidden="true" />
                <span>
                  <strong>Thêm bài hát</strong>
                  <small>Tìm kiếm và chọn nhạc kèm bản nghe thử 30s</small>
                </span>
              </button>
            )}

            {error && (
              <p className="note-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              {current && (
                <button
                  type="button"
                  className="note-delete"
                  disabled={busy || saving}
                  onClick={() => void remove()}
                >
                  <Trash2 aria-hidden="true" />
                  Xóa
                </button>
              )}
              <button
                type="button"
                className="note-save"
                disabled={busy || saving || !body.trim()}
                onClick={() => void save()}
              >
                {saving ? 'Đang lưu…' : 'Chia sẻ ghi chú'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

export function ActiveFriends({
  loading,
  unavailable,
  online,
  friends,
  presence,
  notes,
  currentUser,
  hasFriends,
  presenceLoaded,
  busy,
  onRetry,
  onOpen,
  onNoteChange,
}: {
  loading: boolean;
  unavailable: boolean;
  online: Peer[];
  friends?: Peer[];
  presence?: Record<string, Presence>;
  notes: FriendNote[];
  currentUser: Peer;
  hasFriends: boolean;
  presenceLoaded: boolean;
  busy: boolean;
  onRetry: () => void;
  onOpen: (peerId: string) => void;
  onNoteChange: (note?: FriendNote) => void;
}) {
  const [composing, setComposing] = useState(false);
  const [playing, setPlaying] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const audio = useRef<HTMLAudioElement | null>(null);
  const mine = notes.find((note) => note.user.id === currentUser.id);
  const friendNotes = notes.filter((note) => note.user.id !== currentUser.id);
  const allPeers = friends ?? online;
  const remainingPeers = allPeers
    .filter((peer) => !friendNotes.some((note) => note.user.id === peer.id))
    .sort((a, b) => {
      const aOnline =
        presence?.[a.id]?.online ?? online.some((item) => item.id === a.id);
      const bOnline =
        presence?.[b.id]?.online ?? online.some((item) => item.id === b.id);
      if (aOnline !== bOnline) return aOnline ? -1 : 1;
      const aLast = presence?.[a.id]?.lastActiveAt
        ? Date.parse(presence[a.id].lastActiveAt ?? '')
        : 0;
      const bLast = presence?.[b.id]?.lastActiveAt
        ? Date.parse(presence[b.id].lastActiveAt ?? '')
        : 0;
      if (aLast !== bLast) return bLast - aLast;
      return a.displayName.localeCompare(b.displayName, 'vi');
    });
  const shown = [
    ...friendNotes.map((note) => ({ peer: note.user, note })),
    ...remainingPeers.map((peer) => ({ peer, note: undefined })),
  ];
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  function play(note: FriendNote) {
    const previewSrc =
      note.musicPreviewUrl ??
      (note.musicTitle
        ? DEFAULT_TRENDING_TRACKS.find(
            (t) => t.title.toLowerCase() === note.musicTitle?.toLowerCase(),
          )?.previewUrl
        : undefined);
    if (!previewSrc) return;
    if (playing === note.user.id) {
      audio.current?.pause();
      setPlaying(undefined);
      return;
    }
    audio.current?.pause();
    const next = new Audio(previewSrc);
    audio.current = next;
    next.addEventListener('ended', () => setPlaying(undefined), { once: true });
    void next
      .play()
      .then(() => setPlaying(note.user.id))
      .catch(() => setPlaying(undefined));
  }
  useEffect(() => () => audio.current?.pause(), []);
  return (
    <section
      className="active-friends"
      aria-label="Ghi chú và bạn bè đang hoạt động"
    >
      {!loading && !unavailable && (
        <ul className="active-friends-list notes-list">
          <li className="note-person mine">
            <button
              type="button"
              disabled={busy}
              onClick={() => setComposing(true)}
              aria-label={
                mine ? `Sửa ghi chú: ${mine.body}` : 'Tạo ghi chú mới'
              }
            >
              <span
                className={`note-bubble${mine ? '' : ' is-placeholder'}${
                  playing === currentUser.id ? ' is-playing' : ''
                }`}
                onClick={(e) => {
                  if (mine?.musicTitle) {
                    e.stopPropagation();
                    play(mine);
                  }
                }}
                title={
                  mine?.musicTitle
                    ? playing === currentUser.id
                      ? 'Bấm để tạm dừng nhạc · Bấm vào avatar để sửa ghi chú'
                      : `Bấm để nghe "${mine.musicTitle}" · Bấm vào avatar để sửa ghi chú`
                    : undefined
                }
              >
                <span className="note-bubble-text">
                  {mine?.body ?? 'Ghi chú…'}
                </span>
                {mine?.musicTitle && (
                  <small>
                    {playing === currentUser.id ? (
                      <Pause aria-hidden="true" />
                    ) : (
                      <Music2 aria-hidden="true" />
                    )}
                    <span>{mine.musicTitle}</span>
                  </small>
                )}
              </span>
              <span className="active-friend-avatar">
                <Avatar peer={currentUser} />
                <span className="note-add" aria-hidden="true">
                  <Plus />
                </span>
              </span>
              <span className="active-friend-name">Tin của bạn</span>
            </button>
          </li>
          {shown.map(({ peer, note }) => {
            const peerPresence = presence?.[peer.id];
            const isOnline =
              peerPresence?.online ??
              online.some((item) => item.id === peer.id);
            const offlineBadge = !isOnline
              ? presenceBadge(peerPresence, now)
              : '';
            return (
              <li key={peer.id} className="note-person">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOpen(peer.id)}
                  aria-label={
                    note
                      ? `Ghi chú của ${peer.displayName}: ${note.body}`
                      : `Nhắn tin cho ${peer.displayName}`
                  }
                >
                  {note && (
                    <span
                      className={`note-bubble${
                        playing === peer.id ? ' is-playing' : ''
                      }${note.musicTitle ? ' has-music' : ''}`}
                      onClick={(e) => {
                        if (note.musicTitle) {
                          e.stopPropagation();
                          play(note);
                        }
                      }}
                      title={
                        note.musicTitle
                          ? playing === peer.id
                            ? `Đang phát: ${note.musicTitle} (Bấm để dừng)`
                            : `Bấm để nghe: ${note.musicTitle}`
                          : undefined
                      }
                    >
                      <span className="note-bubble-text">{note.body}</span>
                      {note.musicTitle && (
                        <small>
                          {playing === peer.id ? (
                            <Pause aria-hidden="true" />
                          ) : (
                            <Music2 aria-hidden="true" />
                          )}
                          <span>{note.musicTitle}</span>
                        </small>
                      )}
                    </span>
                  )}
                  <span className="active-friend-avatar presence-avatar">
                    <Avatar peer={peer} />
                    {isOnline ? (
                      <span
                        className="presence-dot"
                        title="Đang hoạt động"
                        aria-hidden="true"
                      />
                    ) : (
                      offlineBadge && (
                        <span
                          className="presence-last-active"
                          title={presenceLabel(peerPresence, now)}
                          aria-label={presenceLabel(peerPresence, now)}
                        >
                          {offlineBadge}
                        </span>
                      )
                    )}
                  </span>
                  <span className="active-friend-name">{peer.displayName}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {loading ? (
        <p className="active-friends-status" role="status">
          Đang tải bạn bè…
        </p>
      ) : unavailable ? (
        <p className="active-friends-status">
          Chưa tải được danh sách bạn bè.
          <button
            type="button"
            className="retry"
            disabled={busy}
            onClick={onRetry}
          >
            Thử lại
          </button>
        </p>
      ) : (
        shown.length === 0 && (
          <p className="active-friends-status">
            {!presenceLoaded && hasFriends
              ? 'Đang cập nhật trạng thái…'
              : 'Tạo ghi chú đầu tiên để bạn bè biết bạn đang nghĩ gì.'}
          </p>
        )
      )}
      {composing && (
        <NoteComposer
          current={mine}
          busy={busy}
          onClose={() => setComposing(false)}
          onSaved={(note) => {
            onNoteChange(note);
            setComposing(false);
          }}
          onDeleted={() => {
            onNoteChange();
            setComposing(false);
          }}
        />
      )}
    </section>
  );
}
