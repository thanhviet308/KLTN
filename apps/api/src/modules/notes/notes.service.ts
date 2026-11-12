import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Friendship } from '../database/entities/friendship.entity';
import { UserNote } from '../database/entities/user-note.entity';
import { publicUserView } from '../users/user-view';
import type { SaveNoteDto } from './notes.dto';

export interface MusicCatalogTrack {
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

@Injectable()
export class NotesService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}

  async searchMusic(rawQuery: string): Promise<{ items: MusicCatalogTrack[] }> {
    const query = rawQuery.trim();
    if (!query) {
      return { items: DEFAULT_TRENDING_TRACKS };
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      timer.unref?.();
      const response = await fetch(
        `https://itunes.apple.com/search?media=music&entity=song&country=VN&limit=20&term=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      );
      clearTimeout(timer);
      if (response.ok) {
        const data = (await response.json()) as {
          results?: Array<{
            trackId?: number;
            trackName?: string;
            artistName?: string;
            artworkUrl100?: string;
            previewUrl?: string;
            trackViewUrl?: string;
          }>;
        };
        const items: MusicCatalogTrack[] = (data.results ?? [])
          .filter((item) => item.trackName)
          .map((item) => ({
            id: String(item.trackId ?? `${item.trackName}-${item.artistName}`),
            title: String(item.trackName ?? '').slice(0, 120),
            artist: String(item.artistName ?? '').slice(0, 120),
            artworkUrl: item.artworkUrl100 ?? null,
            previewUrl: item.previewUrl ?? null,
            trackUrl: item.trackViewUrl ?? null,
          }));
        if (items.length > 0) {
          return { items };
        }
      }
    } catch {
      // Fallback to local filter below
    }
    const lower = query.toLowerCase();
    return {
      items: DEFAULT_TRENDING_TRACKS.filter(
        (t) =>
          t.title.toLowerCase().includes(lower) ||
          t.artist.toLowerCase().includes(lower),
      ),
    };
  }

  private view(note: UserNote) {
    return {
      user: publicUserView(note.user),
      body: note.body,
      musicTitle: note.musicTitle,
      musicArtist: note.musicArtist,
      musicUrl: note.musicUrl,
      musicPreviewUrl: note.musicPreviewUrl,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      expiresAt: note.expiresAt,
    };
  }

  async list(userId: string) {
    const friendships = await this.db.getRepository(Friendship).find({
      where: [
        { requesterId: userId, status: 'accepted' },
        { recipientId: userId, status: 'accepted' },
      ],
    });
    const ids = new Set([userId]);
    for (const row of friendships)
      ids.add(row.requesterId === userId ? row.recipientId : row.requesterId);
    const notes = await this.db
      .getRepository(UserNote)
      .createQueryBuilder('note')
      .innerJoinAndSelect('note.user', 'user')
      .where('note.user_id IN (:...ids)', { ids: [...ids] })
      .andWhere('note.expires_at > now()')
      .andWhere("user.status = 'active'")
      .orderBy('note.updated_at', 'DESC')
      .getMany();
    return { items: notes.map((note) => this.view(note)) };
  }

  async save(userId: string, input: SaveNoteDto) {
    const repo = this.db.getRepository(UserNote);
    const existing = await repo.findOne({
      where: { userId },
      relations: { user: true },
    });
    const note = repo.create({
      ...existing,
      userId,
      body: input.body,
      musicTitle: input.musicTitle ?? null,
      musicArtist: input.musicTitle ? input.musicArtist || null : null,
      musicUrl: input.musicTitle ? input.musicUrl || null : null,
      musicPreviewUrl: input.musicTitle ? input.musicPreviewUrl || null : null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const saved = await repo.save(note);
    saved.user =
      existing?.user ??
      (
        await repo.findOneOrFail({
          where: { userId },
          relations: { user: true },
        })
      ).user;
    return { note: this.view(saved) };
  }

  async remove(userId: string) {
    await this.db.getRepository(UserNote).delete({ userId });
  }
}
