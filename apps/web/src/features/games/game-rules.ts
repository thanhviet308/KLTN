export type GameType =
  | 'memory_match'
  | 'treasure_hunt'
  | 'rps_showdown'
  | 'pirate_roulette'
  | 'sudoku_duel'
  | 'caro'
  | 'xiangqi'
  | 'chess'
  | 'othello'
  | 'checkers'
  | 'co_ganh'
  | 'connect_four'
  | 'tic_tac_toe'
  | 'group_bomb_pass'
  | 'group_truth_dare'
  | 'group_lucky_wheel'
  | 'group_spy_hunt'
  | 'group_heist_vault'
  | 'group_quiz_arena';

export type GameCategory =
  | 'all'
  | 'party_adventure'
  | 'puzzle_memory'
  | 'strategy'
  | 'board_line'
  | 'group_party'
  | 'group_deduction'
  | 'group_brain';

export interface GameMeta {
  name: string;
  subtitle: string;
  description: string;
  badge: string;
  winRule: string;
  category: Exclude<GameCategory, 'all'>;
  rows: number;
  columns: number;
  win?: number;
  stepMove?: boolean;
  groupOnly?: boolean;
}

export const TRUTH_DARE_PROMPTS: Record<
  number,
  { kind: 'truth' | 'dare'; badge: string; text: string }
> = {
  101: {
    kind: 'truth',
    badge: '💬 Sự Thật (+15đ)',
    text: 'Ấn tượng đầu tiên của bạn về các thành viên trong nhóm này là gì?',
  },
  102: {
    kind: 'truth',
    badge: '💬 Sự Thật (+15đ)',
    text: 'Kỷ niệm đáng nhớ hoặc buồn cười nhất của bạn với một người trong nhóm là gì?',
  },
  103: {
    kind: 'truth',
    badge: '💬 Sự Thật (+15đ)',
    text: 'Nếu cả nhóm cùng đi du lịch tự túc, bạn nghĩ ai sẽ là người dẫn đường và ai dễ bị lạc nhất?',
  },
  104: {
    kind: 'truth',
    badge: '💬 Sự Thật (+15đ)',
    text: 'Thói quen kỳ lạ nào của bạn mà ít ai trong nhóm biết tới?',
  },
  105: {
    kind: 'truth',
    badge: '💬 Sự Thật (+15đ)',
    text: 'Trong nhóm mình, bạn tin tưởng giao bí mật lớn nhất cho ai?',
  },
  106: {
    kind: 'truth',
    badge: '💬 Sự Thật (+15đ)',
    text: 'Món ăn hoặc thức uống nào bạn có thể ăn suốt cả tuần không chán?',
  },
  201: {
    kind: 'dare',
    badge: '🔥 Thử Thách (+25đ)',
    text: 'Gửi ngay 3 biểu tượng cảm xúc (emoji) diễn tả tâm trạng hiện tại của bạn vào nhóm chat!',
  },
  202: {
    kind: 'dare',
    badge: '🔥 Thử Thách (+25đ)',
    text: 'Đặt biệt danh hài hước cho người vừa đi lượt trước bạn trong khung chat nhóm!',
  },
  203: {
    kind: 'dare',
    badge: '🔥 Thử Thách (+25đ)',
    text: 'Gửi một câu khen ngợi thật ngầu dành cho tất cả thành viên trong nhóm ngay bây giờ!',
  },
  204: {
    kind: 'dare',
    badge: '🔥 Thử Thách (+25đ)',
    text: 'Kể một câu chuyện cười ngắn hoặc câu đố mẹo trong khung chat nhóm trong vòng 1 phút!',
  },
  205: {
    kind: 'dare',
    badge: '🔥 Thử Thách (+25đ)',
    text: 'Dùng tính năng ghi âm hoặc nhắn tin hát 1 câu bài hát bạn yêu thích vào nhóm!',
  },
  206: {
    kind: 'dare',
    badge: '🔥 Thử Thách (+25đ)',
    text: 'Thả cảm xúc (reaction) vào 3 tin nhắn gần nhất trong cuộc trò chuyện nhóm này!',
  },
};

export const GROUP_QUIZ_BANK: {
  question: string;
  options: [string, string, string, string];
  answer: number;
}[] = [
  {
    question: 'Quốc gia nào có diện tích lớn nhất thế giới?',
    options: ['Canada', 'Nga', 'Trung Quốc', 'Mỹ'],
    answer: 1,
  },
  {
    question:
      'Tỉnh/thành nào ở Việt Nam nổi tiếng với danh xưng "Thành phố ngàn hoa"?',
    options: ['Nha Trang', 'Sa Pa', 'Đà Lạt', 'Huế'],
    answer: 2,
  },
  {
    question: 'Hành tinh nào nằm gần Mặt Trời nhất trong Hệ Mặt Trời?',
    options: ['Sao Thủy', 'Sao Kim', 'Sao Hỏa', 'Trái Đất'],
    answer: 0,
  },
  {
    question: 'Môn thể thao nào được mệnh danh là "Môn thể thao vua"?',
    options: ['Bóng rổ', 'Quần vợt', 'Bơi lội', 'Bóng đá'],
    answer: 3,
  },
  {
    question: 'Con vật nào sau đây ngủ trong tư thế đứng?',
    options: ['Mèo', 'Ngựa', 'Gấu trúc', 'Thỏ'],
    answer: 1,
  },
  {
    question: 'Đỉnh núi cao nhất Việt Nam ("Nóc nhà Đông Dương") là đỉnh nào?',
    options: ['Bạch Mộc Lương Tử', 'Pu Ta Leng', 'Fansipan', 'Langbiang'],
    answer: 2,
  },
  {
    question: 'Kim loại nào dẫn điện tốt nhất trong điều kiện thường?',
    options: ['Bạc (Ag)', 'Đồng (Cu)', 'Vàng (Au)', 'Nhôm (Al)'],
    answer: 0,
  },
  {
    question: 'Một năm nhuận dương lịch có tổng cộng bao nhiêu ngày?',
    options: ['365 ngày', '366 ngày', '364 ngày', '360 ngày'],
    answer: 1,
  },
  {
    question: 'Vịnh Hạ Long thuộc địa phận tỉnh nào của Việt Nam?',
    options: ['Hải Phòng', 'Ninh Bình', 'Thanh Hóa', 'Quảng Ninh'],
    answer: 3,
  },
  {
    question: 'Loài chim nào có khả năng bay lùi duy nhất trên thế giới?',
    options: ['Chim đại bàng', 'Chim cánh cụt', 'Chim ruồi', 'Chim én'],
    answer: 2,
  },
];

export const MEMORY_ICONS: Record<number, { emoji: string; label: string }> = {
  1: { emoji: '🦊', label: 'Cáo Đỏ' },
  2: { emoji: '🐼', label: 'Gấu Trúc' },
  3: { emoji: '🦁', label: 'Sư Tử' },
  4: { emoji: '🐸', label: 'Ếch Xanh' },
  5: { emoji: '🐙', label: 'Bạch Tuộc' },
  6: { emoji: '🦄', label: 'Kỳ Lân' },
  7: { emoji: '🐝', label: 'Ong Vàng' },
  8: { emoji: '🐳', label: 'Cá Voi' },
};

export const RPS_HANDS: Record<
  number,
  { emoji: string; name: string; desc: string }
> = {
  1: { emoji: '✊', name: 'Búa', desc: 'Thắng Kéo' },
  2: { emoji: '✋', name: 'Bao', desc: 'Thắng Búa' },
  3: { emoji: '✌️', name: 'Kéo', desc: 'Thắng Bao' },
};

export const GAME_INFO: Record<GameType, GameMeta> = {
  memory_match: {
    name: 'Lật Hình Trí Nhớ',
    subtitle: 'Trí nhớ & Quan sát',
    description:
      'Lật 2 thẻ bài mỗi lượt để tìm 8 cặp thú cưng trùng khớp. Tìm đúng cặp sẽ được thưởng thêm lượt lật liên tiếp!',
    badge: '4×4 · Lật thẻ bài',
    winRule: 'Tìm nhiều cặp hình nhất',
    category: 'puzzle_memory',
    rows: 4,
    columns: 4,
  },
  treasure_hunt: {
    name: 'Săn Kho Báu Né Bom',
    subtitle: 'Phiêu lưu & Dò mìn',
    description:
      'Đào đất trên đảo hoang 6×6 để săn Kim Cương (+4đ), Túi Vàng (+2đ), dựa vào số radar báo kho báu lân cận và tránh Bom (-2đ)!',
    badge: '6×6 · Đào kho báu',
    winRule: 'Nhiều điểm kho báu nhất',
    category: 'party_adventure',
    rows: 6,
    columns: 6,
  },
  rps_showdown: {
    name: 'Oẳn Tù Tì Đại Chiến',
    subtitle: 'Đấu tâm lý 5 hiệp',
    description:
      'Bí mật khóa chiêu Búa ✊, Bao ✋ hoặc Kéo ✌️ trong từng hiệp đấu. Ai giành được 3 hiệp thắng trước sẽ lên ngôi vô địch!',
    badge: 'BO5 · Phản xạ & Tâm lý',
    winRule: 'Thắng 3 trên 5 hiệp',
    category: 'party_adventure',
    rows: 1,
    columns: 3,
  },
  pirate_roulette: {
    name: 'Hải Tặc Đâm Thùng',
    subtitle: 'Tiệc tùng & Hồi hộp',
    description:
      'Lần lượt cắm kiếm vào 20 khe trên thùng rượu Hải Tặc để gom xu vàng — nhưng cẩn thận kẻo đâm trúng khe làm Hải Tặc bật tung!',
    badge: '20 khe · Thử vận may',
    winRule: 'Không đâm trúng bẫy Hải Tặc',
    category: 'party_adventure',
    rows: 4,
    columns: 5,
  },
  sudoku_duel: {
    name: 'Giải Mã Sudoku Đôi',
    subtitle: 'Giải đố & Logic số',
    description:
      'Thi giải mật mã số 1–4 sao cho mỗi hàng, cột và ô vuông 2×2 không trùng nhau. Điền đúng +2 điểm, đoán sai -1 điểm!',
    badge: '4×4 · Đấu trí logic',
    winRule: 'Nhiều điểm giải mã nhất',
    category: 'puzzle_memory',
    rows: 4,
    columns: 4,
  },
  xiangqi: {
    name: 'Cờ tướng',
    subtitle: 'Kỳ đạo phương Đông',
    description:
      'Đấu trí trên bàn cờ 9×10 truyền thống qua sông Sở Hà – Hán Giới. Điều binh khiển tướng để bắt Tướng đối phương.',
    badge: '10×9 · Cờ truyền thống',
    winRule: 'Bắt Tướng đối phương',
    category: 'strategy',
    rows: 10,
    columns: 9,
    stepMove: true,
  },
  chess: {
    name: 'Cờ vua',
    subtitle: 'Trí tuệ quốc tế',
    description:
      'Bàn cờ 8×8 chuẩn quốc tế với đầy đủ Vua, Hậu, Xe, Tượng, Mã, Tốt và tự động phong Hậu khi Tốt chạm hàng cuối.',
    badge: '8×8 · Cờ quốc tế',
    winRule: 'Chiếu bắt Vua đối phương',
    category: 'strategy',
    rows: 8,
    columns: 8,
    stepMove: true,
  },
  caro: {
    name: 'Caro 5 quân',
    subtitle: 'Chiến thuật cổ điển',
    description:
      'Đấu trí trên bàn cờ gỗ 15×15. Ai xếp được 5 quân liên tiếp theo hàng ngang, dọc hoặc chéo trước sẽ giành chiến thắng.',
    badge: '15×15 · Xếp 5 quân',
    winRule: '5 quân liên tiếp',
    category: 'board_line',
    rows: 15,
    columns: 15,
    win: 5,
  },
  othello: {
    name: 'Cờ lật Othello',
    subtitle: 'Kẹp & lật quân',
    description:
      'Đặt quân để kẹp hàng quân đối phương ở giữa và lật toàn bộ sang màu của bạn. Ai chiếm nhiều ô hơn khi kín bàn sẽ thắng.',
    badge: '8×8 · Lật cờ',
    winRule: 'Nhiều quân nhất cuối trận',
    category: 'board_line',
    rows: 8,
    columns: 8,
  },
  checkers: {
    name: 'Cờ đam',
    subtitle: 'Nhảy chéo bắt quân',
    description:
      'Di chuyển chéo trên các ô sẫm màu, nhảy qua quân địch để bắt gọn và phong Vua Đam khi tiến tới hàng cuối cùng.',
    badge: '8×8 · Nhảy chéo',
    winRule: 'Ăn hết hoặc khóa quân địch',
    category: 'strategy',
    rows: 8,
    columns: 8,
    stepMove: true,
  },
  co_ganh: {
    name: 'Cờ gánh',
    subtitle: 'Dân gian Việt Nam',
    description:
      'Trò chơi dân gian trên bàn 5×5: đi vào giữa hai quân đối phương để "Gánh" hoặc vây hai đầu để "Chẹt" và thu phục quân.',
    badge: '5×5 · Dân gian',
    winRule: 'Thu phục toàn bộ quân địch',
    category: 'strategy',
    rows: 5,
    columns: 5,
    stepMove: true,
  },
  connect_four: {
    name: 'Bốn quân liên tiếp',
    subtitle: 'Thả đĩa xếp hàng',
    description:
      'Thả đĩa màu vào 7 cột. Đĩa sẽ rơi xuống ô trống thấp nhất — hãy khéo léo xếp đủ 4 đĩa liên tiếp để thắng.',
    badge: '6×7 · Thả đĩa',
    winRule: '4 đĩa liên tiếp',
    category: 'board_line',
    rows: 6,
    columns: 7,
    win: 4,
  },
  tic_tac_toe: {
    name: 'Cờ 3×3',
    subtitle: 'Đối kháng siêu tốc',
    description:
      'Ván đấu gọn nhẹ trên bàn 3×3. Phù hợp để giải trí nhanh trong lúc chờ tin nhắn cùng bạn bè.',
    badge: '3×3 · Siêu tốc',
    winRule: '3 quân liên tiếp',
    category: 'board_line',
    rows: 3,
    columns: 3,
    win: 3,
  },
  group_bomb_pass: {
    name: 'Chuyền Bom Hẹn Giờ',
    subtitle: 'Tiệc tùng nhóm · Cắt dây bom',
    description:
      'Các thành viên trong nhóm lần lượt chọn cắt 1 trong 16 sợi dây trên quả bom hẹn giờ để săn điểm thưởng — ai cắt trúng dây ngòi nổ sẽ làm bom nổ tung!',
    badge: 'Nhóm · 16 dây ngòi nổ',
    winRule: 'Tránh dây nổ & gom điểm',
    category: 'group_party',
    rows: 4,
    columns: 4,
    groupOnly: true,
  },
  group_truth_dare: {
    name: 'Sự Thật Hay Thử Thách',
    subtitle: 'Khuấy động phòng chat nhóm',
    description:
      'Bốc 12 phong bì bí ẩn chứa câu hỏi Sự Thật 💬 (+15đ) hoặc yêu cầu Thử Thách 🔥 (+25đ) hiển thị trực tiếp để cả nhóm cùng tương tác sôi nổi!',
    badge: 'Nhóm · Truth or Dare',
    winRule: 'Nhiều điểm khuấy động nhất',
    category: 'group_party',
    rows: 3,
    columns: 4,
    groupOnly: true,
  },
  group_lucky_wheel: {
    name: 'Đua Nhân Phẩm Nhóm',
    subtitle: 'Thử vận may tập thể',
    description:
      'Mở 16 Rương Nhân Phẩm của nhóm để săn Vương Miện (+50đ), Kim Cương (+30đ), Lì Xì (+15đ) và né Hố Đen (-15đ) xem ai là Vua Nhân Phẩm!',
    badge: 'Nhóm · 16 Rương bí ẩn',
    winRule: 'Điểm nhân phẩm cao nhất',
    category: 'group_party',
    rows: 4,
    columns: 4,
    groupOnly: true,
  },
  group_spy_hunt: {
    name: 'Truy Tìm Gián Điệp',
    subtitle: 'Suy luận & Tình báo nhóm',
    description:
      'Dựa vào tín hiệu Radar tình báo trên bản đồ căn cứ 5×5 để cùng nhóm vây bắt 3 Gián điệp 🕵️ (+5đ), thu giữ Hồ sơ mật 📂 (+2đ) và tránh Bẫy báo động 🚨!',
    badge: 'Nhóm · Căn cứ 5×5',
    winRule: 'Bắt nhiều gián điệp nhất',
    category: 'group_deduction',
    rows: 5,
    columns: 5,
    groupOnly: true,
  },
  group_heist_vault: {
    name: 'Phi Vụ Phá Két Sắt',
    subtitle: 'Giải mã 4 vòng khóa số',
    description:
      'Cả nhóm thay phiên thử mật mã 1–4 trên 4 ổ khóa két sắt. Dựa vào tín hiệu gợi ý Lớn hơn (▲) hoặc Nhỏ hơn (▼) để phá khóa 🔓 (+30đ)!',
    badge: 'Nhóm · 4 Khóa mật mã',
    winRule: 'Nhiều điểm phá khóa nhất',
    category: 'group_deduction',
    rows: 1,
    columns: 4,
    groupOnly: true,
  },
  group_quiz_arena: {
    name: 'Đấu Trường Đố Vui Nhóm',
    subtitle: 'Trắc nghiệm tốc độ 5 hiệp',
    description:
      'Tranh tài kiến thức và câu đố thú vị qua 5 câu hỏi trắc nghiệm A/B/C/D trực tiếp trong nhóm. Mỗi câu trả lời đúng ghi ngay +20 điểm!',
    badge: 'Nhóm · 5 Câu hỏi nhanh',
    winRule: 'Cao điểm nhất sau 5 câu',
    category: 'group_brain',
    rows: 1,
    columns: 4,
    groupOnly: true,
  },
};

export const CHESS_PIECES: Record<
  number,
  { glyph: string; name: string; short: string }
> = {
  1: { glyph: '♙', name: 'Tốt Trắng', short: 'Tốt' },
  2: { glyph: '♘', name: 'Mã Trắng', short: 'Mã' },
  3: { glyph: '♗', name: 'Tượng Trắng', short: 'Tượng' },
  4: { glyph: '♖', name: 'Xe Trắng', short: 'Xe' },
  5: { glyph: '♕', name: 'Hậu Trắng', short: 'Hậu' },
  6: { glyph: '♔', name: 'Vua Trắng', short: 'Vua' },
  [-1]: { glyph: '♟', name: 'Tốt Đen', short: 'Tốt' },
  [-2]: { glyph: '♞', name: 'Mã Đen', short: 'Mã' },
  [-3]: { glyph: '♝', name: 'Tượng Đen', short: 'Tượng' },
  [-4]: { glyph: '♜', name: 'Xe Đen', short: 'Xe' },
  [-5]: { glyph: '♛', name: 'Hậu Đen', short: 'Hậu' },
  [-6]: { glyph: '♚', name: 'Vua Đen', short: 'Vua' },
};

export const XIANGQI_PIECES: Record<
  number,
  { hanzi: string; viet: string; name: string }
> = {
  1: { hanzi: '兵', viet: 'Binh', name: 'Binh Đỏ' },
  2: { hanzi: '炮', viet: 'Pháo', name: 'Pháo Đỏ' },
  3: { hanzi: '馬', viet: 'Mã', name: 'Mã Đỏ' },
  4: { hanzi: '車', viet: 'Xe', name: 'Xe Đỏ' },
  5: { hanzi: '相', viet: 'Tượng', name: 'Tượng Đỏ' },
  6: { hanzi: '仕', viet: 'Sĩ', name: 'Sĩ Đỏ' },
  7: { hanzi: '帥', viet: 'Tướng', name: 'Tướng Đỏ' },
  [-1]: { hanzi: '卒', viet: 'Tốt', name: 'Tốt Đen' },
  [-2]: { hanzi: '砲', viet: 'Pháo', name: 'Pháo Đen' },
  [-3]: { hanzi: '馬', viet: 'Mã', name: 'Mã Đen' },
  [-4]: { hanzi: '車', viet: 'Xe', name: 'Xe Đen' },
  [-5]: { hanzi: '象', viet: 'Tượng', name: 'Tượng Đen' },
  [-6]: { hanzi: '士', viet: 'Sĩ', name: 'Sĩ Đen' },
  [-7]: { hanzi: '將', viet: 'Tướng', name: 'Tướng Đen' },
};

export function isOwnCell(
  gameType: GameType,
  value: number,
  myMark: 'X' | 'O',
): boolean {
  if (!value) return false;
  if (
    gameType === 'chess' ||
    gameType === 'xiangqi' ||
    gameType === 'checkers'
  ) {
    return myMark === 'X' ? value > 0 : value < 0;
  }
  return myMark === 'X' ? value === 1 : value === 2;
}

export function getOthelloFlips(
  board: number[],
  cell: number,
  mark: number,
): number[] {
  if (cell < 0 || cell >= 64 || board[cell]) return [];
  const opp = mark === 1 ? 2 : 1;
  const r0 = Math.floor(cell / 8);
  const c0 = cell % 8;
  const flips: number[] = [];
  const dirs = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ] as const;

  for (const [dr, dc] of dirs) {
    const line: number[] = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const idx = r * 8 + c;
      if (board[idx] === opp) {
        line.push(idx);
      } else if (board[idx] === mark) {
        if (line.length > 0) flips.push(...line);
        break;
      } else {
        break;
      }
      r += dr;
      c += dc;
    }
  }
  return flips;
}

export function getValidTargetsForPiece(
  board: number[],
  gameType: GameType,
  from: number,
  myMark: 'X' | 'O',
): Set<number> {
  const targets = new Set<number>();
  const sign: 1 | -1 = myMark === 'X' ? 1 : -1;
  const playerNum = myMark === 'X' ? 1 : 2;

  if (gameType === 'chess') {
    for (let to = 0; to < 64; to++) {
      if (isValidChessMove(board, from, to, sign)) targets.add(to);
    }
  } else if (gameType === 'xiangqi') {
    for (let to = 0; to < 90; to++) {
      if (isValidXiangqiMove(board, from, to, sign)) targets.add(to);
    }
  } else if (gameType === 'checkers') {
    for (let to = 0; to < 64; to++) {
      if (isValidCheckersMove(board, from, to, sign)) targets.add(to);
    }
  } else if (gameType === 'co_ganh') {
    for (let to = 0; to < 25; to++) {
      if (isValidCoGanhMove(board, from, to, playerNum)) targets.add(to);
    }
  }
  return targets;
}

function isValidChessMove(
  board: number[],
  from: number,
  to: number,
  sign: 1 | -1,
): boolean {
  if (from < 0 || from >= 64 || to < 0 || to >= 64 || from === to) return false;
  const piece = board[from] ?? 0;
  if (Math.sign(piece) !== sign) return false;
  const target = board[to] ?? 0;
  if (Math.sign(target) === sign) return false;

  const r1 = Math.floor(from / 8);
  const c1 = from % 8;
  const r2 = Math.floor(to / 8);
  const c2 = to % 8;
  const dr = r2 - r1;
  const dc = c2 - c1;
  const absR = Math.abs(dr);
  const absC = Math.abs(dc);
  const type = Math.abs(piece);

  const clearLine = () => {
    const stepR = Math.sign(dr);
    const stepC = Math.sign(dc);
    let r = r1 + stepR;
    let c = c1 + stepC;
    while (r !== r2 || c !== c2) {
      if (board[r * 8 + c]) return false;
      r += stepR;
      c += stepC;
    }
    return true;
  };

  if (type === 1) {
    const dir = sign === 1 ? -1 : 1;
    const startRow = sign === 1 ? 6 : 1;
    if (dc === 0 && dr === dir && !target) return true;
    if (
      dc === 0 &&
      r1 === startRow &&
      dr === 2 * dir &&
      !target &&
      !board[(r1 + dir) * 8 + c1]
    )
      return true;
    if (absC === 1 && dr === dir && Math.sign(target) === -sign) return true;
    return false;
  }
  if (type === 2)
    return (absR === 2 && absC === 1) || (absR === 1 && absC === 2);
  if (type === 3) return absR === absC && clearLine();
  if (type === 4) return (r1 === r2 || c1 === c2) && clearLine();
  if (type === 5)
    return (absR === absC || r1 === r2 || c1 === c2) && clearLine();
  if (type === 6) return absR <= 1 && absC <= 1;
  return false;
}

function isValidXiangqiMove(
  board: number[],
  from: number,
  to: number,
  sign: 1 | -1,
): boolean {
  if (from < 0 || from >= 90 || to < 0 || to >= 90 || from === to) return false;
  const piece = board[from] ?? 0;
  if (Math.sign(piece) !== sign) return false;
  const target = board[to] ?? 0;
  if (Math.sign(target) === sign) return false;

  const r1 = Math.floor(from / 9);
  const c1 = from % 9;
  const r2 = Math.floor(to / 9);
  const c2 = to % 9;
  const dr = r2 - r1;
  const dc = c2 - c1;
  const absR = Math.abs(dr);
  const absC = Math.abs(dc);
  const type = Math.abs(piece);

  const countBetween = () => {
    const stepR = Math.sign(dr);
    const stepC = Math.sign(dc);
    let r = r1 + stepR;
    let c = c1 + stepC;
    let count = 0;
    while (r !== r2 || c !== c2) {
      if (board[r * 9 + c]) count++;
      r += stepR;
      c += stepC;
    }
    return count;
  };

  const inPalace = (r: number, c: number) => {
    if (c < 3 || c > 5) return false;
    return sign === 1 ? r >= 7 && r <= 9 : r >= 0 && r <= 2;
  };

  if (type === 7) {
    if (c1 === c2 && Math.abs(target) === 7 && countBetween() === 0)
      return true;
    return inPalace(r2, c2) && absR + absC === 1;
  }
  if (type === 6) return inPalace(r2, c2) && absR === 1 && absC === 1;
  if (type === 5) {
    const sameSide = sign === 1 ? r2 >= 5 : r2 <= 4;
    if (!sameSide || absR !== 2 || absC !== 2) return false;
    return !board[((r1 + r2) / 2) * 9 + (c1 + c2) / 2];
  }
  if (type === 3) {
    if (absR === 2 && absC === 1) return !board[(r1 + Math.sign(dr)) * 9 + c1];
    if (absR === 1 && absC === 2) return !board[r1 * 9 + (c1 + Math.sign(dc))];
    return false;
  }
  if (type === 4) return (r1 === r2 || c1 === c2) && countBetween() === 0;
  if (type === 2) {
    if (r1 !== r2 && c1 !== c2) return false;
    const between = countBetween();
    return target === 0 ? between === 0 : between === 1;
  }
  if (type === 1) {
    const dir = sign === 1 ? -1 : 1;
    const crossedRiver = sign === 1 ? r1 <= 4 : r1 >= 5;
    if (dr === dir && dc === 0) return true;
    if (crossedRiver && dr === 0 && absC === 1) return true;
    return false;
  }
  return false;
}

function isValidCheckersMove(
  board: number[],
  from: number,
  to: number,
  sign: 1 | -1,
): boolean {
  if (from < 0 || from >= 64 || to < 0 || to >= 64 || from === to) return false;
  const piece = board[from] ?? 0;
  if (Math.sign(piece) !== sign || board[to]) return false;

  const r1 = Math.floor(from / 8);
  const c1 = from % 8;
  const r2 = Math.floor(to / 8);
  const c2 = to % 8;
  const dr = r2 - r1;
  const dc = c2 - c1;
  const isKing = Math.abs(piece) === 2;
  const forwardDir = sign === 1 ? -1 : 1;

  if (Math.abs(dc) === 1 && Math.abs(dr) === 1) {
    return isKing || dr === forwardDir;
  }
  if (Math.abs(dc) === 2 && Math.abs(dr) === 2) {
    if (!isKing && Math.sign(dr) !== forwardDir) return false;
    const midIdx = ((r1 + r2) / 2) * 8 + (c1 + c2) / 2;
    return Math.sign(board[midIdx] ?? 0) === -sign;
  }
  return false;
}

function isValidCoGanhMove(
  board: number[],
  from: number,
  to: number,
  mark: number,
): boolean {
  if (from < 0 || from >= 25 || to < 0 || to >= 25 || from === to) return false;
  if (board[from] !== mark || board[to] !== 0) return false;
  const r1 = Math.floor(from / 5);
  const c1 = from % 5;
  const r2 = Math.floor(to / 5);
  const c2 = to % 5;
  const absR = Math.abs(r2 - r1);
  const absC = Math.abs(c2 - c1);
  if (absR + absC === 1) return true;
  if (absR === 1 && absC === 1 && (r1 + c1) % 2 === 0) return true;
  return false;
}

export function findWinningCells(
  board: number[],
  gameType: GameType,
): Set<number> {
  const meta = GAME_INFO[gameType];
  if (!meta.win) return new Set();
  const { rows, columns, win } = meta;
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const mark = board[r * columns + c];
      if (!mark) continue;

      for (const [dr, dc] of directions) {
        const endR = r + dr * (win - 1);
        const endC = c + dc * (win - 1);
        if (endR < 0 || endR >= rows || endC < 0 || endC >= columns) continue;

        const cells: number[] = [r * columns + c];
        let matched = true;
        for (let step = 1; step < win; step++) {
          const idx = (r + dr * step) * columns + (c + dc * step);
          if (board[idx] !== mark) {
            matched = false;
            break;
          }
          cells.push(idx);
        }

        if (matched) {
          let extraStep = win;
          while (true) {
            const nr = r + dr * extraStep;
            const nc = c + dc * extraStep;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= columns) break;
            const idx = nr * columns + nc;
            if (board[idx] !== mark) break;
            cells.push(idx);
            extraStep++;
          }
          return new Set(cells);
        }
      }
    }
  }
  return new Set();
}

export function findDropTargetCell(
  board: number[],
  column: number,
  rows: number,
  columns: number,
): number {
  for (let r = rows - 1; r >= 0; r--) {
    const idx = r * columns + column;
    if (!board[idx]) return idx;
  }
  return -1;
}
