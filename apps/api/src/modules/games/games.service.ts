import {
  HttpException,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { Conversation } from '../database/entities/conversation.entity';
import { ConversationMember } from '../database/entities/conversation-member.entity';
import {
  GameSession,
  type ArcadeGameType,
} from '../database/entities/game-session.entity';
import { Message } from '../database/entities/message.entity';
import { RealtimeEvents } from '../realtime/realtime-events.module';

type GameType = ArcadeGameType;

const GAME_TITLES: Record<GameType, string> = {
  caro: 'Caro 5 quân',
  tic_tac_toe: 'Cờ 3×3',
  connect_four: 'Bốn quân liên tiếp',
  chess: 'Cờ vua',
  xiangqi: 'Cờ tướng',
  othello: 'Cờ lật Othello',
  checkers: 'Cờ đam',
  co_ganh: 'Cờ gánh',
  memory_match: 'Lật Hình Trí Nhớ',
  treasure_hunt: 'Săn Kho Báu Né Bom',
  rps_showdown: 'Oẳn Tù Tì Đại Chiến',
  pirate_roulette: 'Hải Tặc Đâm Thùng',
  sudoku_duel: 'Giải Mã Sudoku Đôi',
  group_bomb_pass: 'Chuyền Bom Hẹn Giờ',
  group_truth_dare: 'Sự Thật Hay Thử Thách',
  group_lucky_wheel: 'Đua Nhân Phẩm Nhóm',
  group_spy_hunt: 'Truy Tìm Gián Điệp',
  group_heist_vault: 'Phi Vụ Phá Két Sắt',
  group_quiz_arena: 'Đấu Trường Đố Vui Nhóm',
};

const GROUP_GAME_TYPES = new Set<GameType>([
  'group_bomb_pass',
  'group_truth_dare',
  'group_lucky_wheel',
  'group_spy_hunt',
  'group_heist_vault',
  'group_quiz_arena',
]);

const TURN_LIMIT_SECONDS: Record<GameType, number> = {
  caro: 45,
  tic_tac_toe: 25,
  connect_four: 30,
  chess: 45,
  xiangqi: 45,
  othello: 45,
  checkers: 45,
  co_ganh: 45,
  memory_match: 30,
  treasure_hunt: 30,
  rps_showdown: 25,
  pirate_roulette: 25,
  sudoku_duel: 45,
  group_bomb_pass: 25,
  group_truth_dare: 25,
  group_lucky_wheel: 25,
  group_spy_hunt: 30,
  group_heist_vault: 30,
  group_quiz_arena: 25,
};

// Correct option index (0..3) for the 10 group quiz questions
const GROUP_QUIZ_ANSWERS: number[] = [1, 2, 0, 3, 1, 2, 0, 1, 3, 2];

const BOARD_DIMS: Record<
  GameType,
  { rows: number; columns: number; win?: number }
> = {
  caro: { rows: 15, columns: 15, win: 5 },
  tic_tac_toe: { rows: 3, columns: 3, win: 3 },
  connect_four: { rows: 6, columns: 7, win: 4 },
  chess: { rows: 8, columns: 8 },
  xiangqi: { rows: 10, columns: 9 },
  othello: { rows: 8, columns: 8 },
  checkers: { rows: 8, columns: 8 },
  co_ganh: { rows: 5, columns: 5 },
  memory_match: { rows: 4, columns: 4 },
  treasure_hunt: { rows: 6, columns: 6 },
  rps_showdown: { rows: 1, columns: 3 },
  pirate_roulette: { rows: 4, columns: 5 },
  sudoku_duel: { rows: 4, columns: 4 },
  group_bomb_pass: { rows: 4, columns: 4 },
  group_truth_dare: { rows: 3, columns: 4 },
  group_lucky_wheel: { rows: 4, columns: 4 },
  group_spy_hunt: { rows: 5, columns: 5 },
  group_heist_vault: { rows: 1, columns: 4 },
  group_quiz_arena: { rows: 1, columns: 4 },
};

function fail(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

const SUDOKU_SOLUTIONS: number[][] = [
  [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1],
  [2, 1, 4, 3, 4, 3, 2, 1, 1, 2, 3, 4, 3, 4, 1, 2],
  [3, 4, 1, 2, 1, 2, 3, 4, 4, 3, 2, 1, 2, 1, 4, 3],
  [4, 3, 2, 1, 2, 1, 4, 3, 3, 4, 1, 2, 1, 2, 3, 4],
  [1, 3, 4, 2, 4, 2, 1, 3, 2, 4, 3, 1, 3, 1, 2, 4],
];

function initialBoard(gameType: GameType): number[] {
  if (gameType === 'memory_match') {
    // Public [0..15]: visible card states (0=face down, 1..8=matched, 11..18=flipped)
    // [16]: X score, [17]: O score, [18]: firstPick (-1), [19]: prevMisA (-1), [20]: prevMisB (-1)
    // Secret [21..36]: shuffled deck of pairs 1..8
    const deck = shuffle([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]);
    return [...Array<number>(16).fill(0), 0, 0, -1, -1, -1, ...deck];
  }
  if (gameType === 'treasure_hunt') {
    // Public [0..35]: 0=unopened, 10..18=radar count, 20=Gold(+2), 30=Diamond(+4), -10=Bomb(-2)
    // [36]: X score, [37]: O score, [38]: treasures remaining (12), [39]: lastEvent
    // Secret [40..75]: full map
    const positions = shuffle(Array.from({ length: 36 }, (_, i) => i));
    const secret = Array<number>(36).fill(0);
    for (let i = 0; i < 5; i++) secret[positions[i]!] = 30; // 5 Diamonds
    for (let i = 5; i < 12; i++) secret[positions[i]!] = 20; // 7 Gold bags
    for (let i = 12; i < 18; i++) secret[positions[i]!] = -10; // 6 Bombs
    // Fill radar counts for remaining cells
    for (let idx = 0; idx < 36; idx++) {
      if (secret[idx] !== 0) continue;
      const r0 = Math.floor(idx / 6);
      const c0 = idx % 6;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = r0 + dr;
          const c = c0 + dc;
          if (r >= 0 && r < 6 && c >= 0 && c < 6) {
            const val = secret[r * 6 + c]!;
            if (val === 20 || val === 30) count++;
          }
        }
      }
      secret[idx] = 10 + count;
    }
    return [...Array<number>(36).fill(0), 0, 0, 12, 0, ...secret];
  }
  if (gameType === 'rps_showdown') {
    // [0]: X score, [1]: O score, [2..11]: up to 5 rounds of (xChoice, oChoice) where 1=Rock, 2=Paper, 3=Scissors
    // [12]: current round index (0..4), [13]: lastRoundWinner (0=none/draw, 1=X, 2=O),
    // [14]: xLockedFlag (0 or 1), [15]: secretXChoice (1..3)
    return Array<number>(16).fill(0);
  }
  if (gameType === 'pirate_roulette') {
    // Public [0..19]: 20 barrel slots (0=empty, 1=X sword, 2=O sword, 3=X gold slot, 4=O gold slot, -9=TRAP!)
    // [20]: X gold, [21]: O gold, [22]: secret trap slot (0..19), [23..26]: 4 bonus gold slots
    const slots = shuffle(Array.from({ length: 20 }, (_, i) => i));
    const trap = slots[0]!;
    const goldSlots = slots.slice(1, 5);
    return [...Array<number>(20).fill(0), 0, 0, trap, ...goldSlots];
  }
  if (gameType === 'sudoku_duel') {
    // Public [0..15]: 4x4 grid (0=empty, 1..4=given clue, 11..14=X solved, 21..24=O solved)
    // [16]: X score, [17]: O score, [18]: lastStatus (0=init, 1=correct, -1=wrong)
    // Secret [19..34]: 16 solution cells
    const sol =
      SUDOKU_SOLUTIONS[Math.floor(Math.random() * SUDOKU_SOLUTIONS.length)]!;
    const indices = shuffle(Array.from({ length: 16 }, (_, i) => i));
    const puzzle = Array<number>(16).fill(0);
    for (let i = 0; i < 6; i++) {
      const idx = indices[i]!;
      puzzle[idx] = sol[idx]!;
    }
    return [...puzzle, 0, 0, 0, ...sol];
  }
  if (gameType === 'group_bomb_pass') {
    // Public [0..15]: 16 wires (0=uncut, 1=X safe, 2=O safe, 3=X bonus, 4=O bonus, -9=BOMB!)
    // [16]: X score, [17]: O score, [18]: secret bomb wire (0..15), [19..22]: 4 bonus wires
    const wires = shuffle(Array.from({ length: 16 }, (_, i) => i));
    return [
      ...Array<number>(16).fill(0),
      0,
      0,
      wires[0]!,
      ...wires.slice(1, 5),
    ];
  }
  if (gameType === 'group_truth_dare') {
    // Public [0..11]: 12 envelopes (0=closed, 101..106=Truth #1..6, 201..206=Dare #1..6)
    // [12]: X score, [13]: O score, [14]: lastPromptId, [15]: lastActor (1=X, 2=O)
    // Secret [16..27]: shuffled deck of 12 prompt IDs
    const deck = shuffle([
      101, 102, 103, 104, 105, 106, 201, 202, 203, 204, 205, 206,
    ]);
    return [...Array<number>(12).fill(0), 0, 0, 0, 0, ...deck];
  }
  if (gameType === 'group_lucky_wheel') {
    // Public [0..15]: 16 mystery chests (0=unopened, 50=Crown, 30=Diamond, 15=RedPacket, 10=Clover, 1=Frog, -15=BlackHole)
    // [16]: X score, [17]: O score, [18]: lastPrize
    // Secret [19..34]: 16 shuffled prizes
    const prizes = shuffle([
      50, 30, 30, 15, 15, 15, 15, 10, 10, 10, 10, 1, 1, 1, -15, -15,
    ]);
    return [...Array<number>(16).fill(0), 0, 0, 0, ...prizes];
  }
  if (gameType === 'group_spy_hunt') {
    // Public [0..24]: 5x5 rooms (0=unopened, 30=Spy(+5), 20=SecretFile(+2), -10=AlarmTrap(-2), 10..18=Radar)
    // [25]: X score, [26]: O score, [27]: targetsRemaining (8), [28]: lastEvent
    // Secret [29..53]: 25 rooms
    const pos = shuffle(Array.from({ length: 25 }, (_, i) => i));
    const secret = Array<number>(25).fill(0);
    for (let i = 0; i < 3; i++) secret[pos[i]!] = 30; // 3 Spies
    for (let i = 3; i < 8; i++) secret[pos[i]!] = 20; // 5 Secret Files
    for (let i = 8; i < 12; i++) secret[pos[i]!] = -10; // 4 Alarm Traps
    for (let idx = 0; idx < 25; idx++) {
      if (secret[idx] !== 0) continue;
      const r0 = Math.floor(idx / 5);
      const c0 = idx % 5;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = r0 + dr;
          const c = c0 + dc;
          if (r >= 0 && r < 5 && c >= 0 && c < 5) {
            const val = secret[r * 5 + c]!;
            if (val === 20 || val === 30) count++;
          }
        }
      }
      secret[idx] = 10 + count;
    }
    return [...Array<number>(25).fill(0), 0, 0, 8, 0, ...secret];
  }
  if (gameType === 'group_heist_vault') {
    // Public [0..3]: 4 locks (0=locked, 11..14=X unlocked digit, 21..24=O unlocked digit)
    // [4..7]: hint per lock (0=none, 1=Higher▲, -1=Lower▼, 2=Cracked)
    // [8..11]: last guessed digit per lock (0 or 1..4)
    // [12]: X score, [13]: O score, [14]: lastResult (0=init, 1=cracked, -1=hint)
    // Secret [15..18]: 4 secret digits (1..4)
    const secretCode = Array.from(
      { length: 4 },
      () => Math.floor(Math.random() * 4) + 1,
    );
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...secretCode];
  }
  if (gameType === 'group_quiz_arena') {
    // [0]: X score, [1]: O score, [2]: currentQuestionStep (0..4, 5=done)
    // [3..7]: 5 question indices from 0..9
    // [8]: lastQuestionIdx (-1), [9]: lastChosenOption (0..3), [10]: lastResult (0=none, 1=correct, -1=wrong), [11]: lastCorrectOption
    const qIndices = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 5);
    return [0, 0, 0, ...qIndices, -1, 0, 0, 0];
  }
  if (gameType === 'chess') {
    return [
      -4, -2, -3, -5, -6, -3, -2, -4, -1, -1, -1, -1, -1, -1, -1, -1, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 4, 2, 3, 5, 6, 3, 2, 4,
    ];
  }
  if (gameType === 'xiangqi') {
    return [
      -4, -3, -5, -6, -7, -6, -5, -3, -4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -2, 0,
      0, 0, 0, 0, -2, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 2, 0, 0, 0, 0,
      0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 3, 5, 6, 7, 6, 5, 3, 4,
    ];
  }
  if (gameType === 'othello') {
    const b = Array<number>(64).fill(0);
    b[3 * 8 + 3] = 2;
    b[3 * 8 + 4] = 1;
    b[4 * 8 + 3] = 1;
    b[4 * 8 + 4] = 2;
    return b;
  }
  if (gameType === 'checkers') {
    const b = Array<number>(64).fill(0);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) {
          if (r <= 2) b[r * 8 + c] = -1;
          else if (r >= 5) b[r * 8 + c] = 1;
        }
      }
    }
    return b;
  }
  if (gameType === 'co_ganh') {
    return [
      2, 2, 2, 2, 2, 2, 0, 0, 0, 2, 2, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1,
    ];
  }
  return [];
}

function sanitizePublicBoard(game: GameSession): number[] {
  const b = game.board ?? [];
  if (game.gameType === 'memory_match') {
    return b.slice(0, 21);
  }
  if (game.gameType === 'treasure_hunt') {
    return b.slice(0, 40);
  }
  if (game.gameType === 'rps_showdown') {
    const pub = b.slice(0, 16);
    pub[15] = 0; // Never leak uncommitted X choice before O plays
    return pub;
  }
  if (game.gameType === 'pirate_roulette') {
    const pub = b.slice(0, 22);
    // Only reveal trap index when finished
    pub.push(game.status === 'active' ? -1 : (b[22] ?? -1));
    return pub;
  }
  if (game.gameType === 'sudoku_duel') {
    return b.slice(0, 19);
  }
  if (game.gameType === 'group_bomb_pass') {
    const pub = b.slice(0, 18);
    pub.push(game.status === 'active' ? -1 : (b[18] ?? -1));
    return pub;
  }
  if (game.gameType === 'group_truth_dare') {
    return b.slice(0, 16);
  }
  if (game.gameType === 'group_lucky_wheel') {
    return b.slice(0, 19);
  }
  if (game.gameType === 'group_spy_hunt') {
    return b.slice(0, 29);
  }
  if (game.gameType === 'group_heist_vault') {
    return b.slice(0, 15);
  }
  if (game.gameType === 'group_quiz_arena') {
    return b.slice(0, 12);
  }
  return b;
}

function getOthelloFlips(
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

function hasAnyOthelloMove(board: number[], mark: number): boolean {
  for (let i = 0; i < 64; i++) {
    if (!board[i] && getOthelloFlips(board, i, mark).length > 0) return true;
  }
  return false;
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

function hasAnyCheckersMove(board: number[], sign: 1 | -1): boolean {
  for (let from = 0; from < 64; from++) {
    if (Math.sign(board[from] ?? 0) !== sign) continue;
    for (let to = 0; to < 64; to++) {
      if (isValidCheckersMove(board, from, to, sign)) return true;
    }
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

function applyCoGanhCaptures(board: number[], to: number, mark: number) {
  const opp = mark === 1 ? 2 : 1;
  const r = Math.floor(to / 5);
  const c = to % 5;
  const axes: [number, number][] = [
    [1, 0],
    [0, 1],
  ];
  if ((r + c) % 2 === 0) {
    axes.push([1, 1], [1, -1]);
  }

  for (const [dr, dc] of axes) {
    const rA = r - dr;
    const cA = c - dc;
    const rB = r + dr;
    const cB = c + dc;
    if (
      rA >= 0 &&
      rA < 5 &&
      cA >= 0 &&
      cA < 5 &&
      rB >= 0 &&
      rB < 5 &&
      cB >= 0 &&
      cB < 5
    ) {
      const idxA = rA * 5 + cA;
      const idxB = rB * 5 + cB;
      if (board[idxA] === opp && board[idxB] === opp) {
        board[idxA] = mark;
        board[idxB] = mark;
      }
    }
  }

  const dirs: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  if ((r + c) % 2 === 0) {
    dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
  }
  for (const [dr, dc] of dirs) {
    const nr = r + dr;
    const nc = c + dc;
    const fr = r + 2 * dr;
    const fc = c + 2 * dc;
    if (
      nr >= 0 &&
      nr < 5 &&
      nc >= 0 &&
      nc < 5 &&
      fr >= 0 &&
      fr < 5 &&
      fc >= 0 &&
      fc < 5
    ) {
      if (Math.abs(dr) === 1 && Math.abs(dc) === 1 && (nr + nc) % 2 !== 0)
        continue;
      const midIdx = nr * 5 + nc;
      const farIdx = fr * 5 + fc;
      if (board[midIdx] === opp && board[farIdx] === mark) {
        board[midIdx] = mark;
      }
    }
  }
}

@Injectable()
export class GamesService implements OnModuleInit {
  private constraintEnsured = false;
  private readonly turnTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly timedOutGames = new Set<string>();

  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(RealtimeEvents) private readonly events: RealtimeEvents,
  ) {}

  async onModuleInit() {
    await this.ensureConstraint().catch(() => {});
  }

  private async ensureConstraint() {
    if (this.constraintEnsured) return;
    await this.db.query(
      'ALTER TABLE "game_sessions" ALTER COLUMN "game_type" TYPE varchar(24)',
    );
    await this.db.query(
      'ALTER TABLE "game_sessions" DROP CONSTRAINT IF EXISTS "game_sessions_type_valid"',
    );
    await this.db.query(
      `ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_type_valid" CHECK (game_type IN ('caro','tic_tac_toe','connect_four','chess','xiangqi','othello','checkers','co_ganh','memory_match','treasure_hunt','rps_showdown','pirate_roulette','sudoku_duel','group_bomb_pass','group_truth_dare','group_lucky_wheel','group_spy_hunt','group_heist_vault','group_quiz_arena'))`,
    );
    this.constraintEnsured = true;
  }

  private view(game: GameSession) {
    const turnLimitSeconds = TURN_LIMIT_SECONDS[game.gameType] ?? 30;
    const turnStartedAt = (
      game.updatedAt ??
      game.createdAt ??
      new Date()
    ).toISOString();
    const forfeitReason =
      game.status === 'forfeited'
        ? this.timedOutGames.has(game.id)
          ? ('timeout' as const)
          : ('surrender' as const)
        : undefined;
    return {
      game: {
        ...game,
        board: sanitizePublicBoard(game),
        turnLimitSeconds,
        turnStartedAt,
        forfeitReason,
      },
    };
  }

  private scheduleTurnTimer(game: GameSession) {
    const prev = this.turnTimers.get(game.id);
    if (prev) {
      clearTimeout(prev);
      this.turnTimers.delete(game.id);
    }
    if (game.status !== 'active') return;
    const limitSec = TURN_LIMIT_SECONDS[game.gameType] ?? 30;
    const refTime = (game.updatedAt ?? game.createdAt ?? new Date()).getTime();
    const elapsedMs = Date.now() - refTime;
    const delayMs = Math.max(250, limitSec * 1000 - elapsedMs + 300);
    const timer = setTimeout(() => {
      this.turnTimers.delete(game.id);
      void this.expireTurnIfOverdue(game.id).catch(() => {});
    }, delayMs);
    timer.unref?.();
    this.turnTimers.set(game.id, timer);
  }

  private async expireTurnIfOverdue(id: string): Promise<GameSession | null> {
    let didExpire = false;
    const updated = await this.db.transaction(async (manager) => {
      const row = await manager
        .getRepository(GameSession)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row) return null;
      if (row.status !== 'active') return row;
      const limitSec = TURN_LIMIT_SECONDS[row.gameType] ?? 30;
      const refTime = (row.updatedAt ?? row.createdAt ?? new Date()).getTime();
      const elapsedMs = Date.now() - refTime;
      if (elapsedMs < limitSec * 1000 - 1200) {
        return row;
      }
      row.status = 'forfeited';
      row.winnerId = row.turn === 'X' ? row.oUserId : row.xUserId;
      row.finishedAt = new Date();
      this.timedOutGames.add(row.id);
      didExpire = true;
      return manager.getRepository(GameSession).save(row);
    });
    if (!updated) return null;
    if (didExpire) {
      await this.publish('', updated);
    } else if (updated.status === 'active') {
      this.scheduleTurnTimer(updated);
    }
    return updated;
  }

  private async publish(actorId: string, game: GameSession) {
    this.scheduleTurnTimer(game);
    const result = this.view(game);
    const members = await this.db
      .getRepository(ConversationMember)
      .findBy({ conversationId: game.conversationId });
    const targetUserIds =
      members.length > 0
        ? members.map((m) => m.userId).filter((uid) => uid !== actorId)
        : [game.xUserId, game.oUserId].filter((uid) => uid !== actorId);
    this.events.publish({
      name: 'game:updated',
      actorId,
      conversationId: game.conversationId,
      targetUserIds,
      payload: result,
    });
    return result;
  }

  private async member(
    manager: EntityManager,
    conversationId: string,
    userId: string,
  ) {
    const member = await manager
      .getRepository(ConversationMember)
      .findOneBy({ conversationId, userId });
    if (!member)
      fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found');
  }

  async current(userId: string, conversationId: string) {
    await this.member(this.db.manager, conversationId, userId);
    let game = await this.db.getRepository(GameSession).findOne({
      where: { conversationId },
      order: { createdAt: 'DESC' },
    });
    if (game && game.status === 'active') {
      const limitSec = TURN_LIMIT_SECONDS[game.gameType] ?? 30;
      const refTime = (
        game.updatedAt ??
        game.createdAt ??
        new Date()
      ).getTime();
      if (Date.now() - refTime >= limitSec * 1000) {
        game = (await this.expireTurnIfOverdue(game.id)) ?? game;
      } else {
        this.scheduleTurnTimer(game);
      }
    }
    return { game: game ? this.view(game).game : null };
  }

  async timeout(userId: string, id: string) {
    const existing = await this.db.getRepository(GameSession).findOneBy({ id });
    if (!existing) fail(404, 'GAME_NOT_FOUND', 'Game was not found');
    await this.member(this.db.manager, existing.conversationId, userId);
    const resolved = (await this.expireTurnIfOverdue(id)) ?? existing;
    return this.view(resolved);
  }

  async create(userId: string, conversationId: string, gameType: GameType) {
    await this.ensureConstraint().catch(() => {});
    const game = await this.db.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`game:${conversationId}`],
      );
      const conversation = await manager
        .getRepository(Conversation)
        .findOneBy({ id: conversationId });
      await this.member(manager, conversationId, userId);
      if (!conversation)
        fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found');

      const isGroupGame = GROUP_GAME_TYPES.has(gameType);
      let opponentId: string | null | undefined;

      if (conversation.type === 'group') {
        if (!isGroupGame) {
          fail(
            400,
            'GAME_GROUP_ONLY',
            'Trong nhóm chỉ hỗ trợ các trò chơi dành riêng cho nhóm',
          );
        }
        const members = await manager
          .getRepository(ConversationMember)
          .findBy({ conversationId });
        const otherMember = members.find((m) => m.userId !== userId);
        if (!otherMember) {
          fail(
            400,
            'GAME_GROUP_NEEDS_MEMBERS',
            'Nhóm cần ít nhất 2 thành viên để mở trò chơi nhóm',
          );
        }
        opponentId = otherMember.userId;
      } else {
        if (isGroupGame) {
          fail(
            400,
            'GAME_GROUP_ONLY',
            'Trò chơi này chỉ dành cho cuộc trò chuyện nhóm',
          );
        }
        opponentId =
          conversation.directUserLowId === userId
            ? conversation.directUserHighId
            : conversation.directUserLowId;
        if (!opponentId)
          fail(400, 'GAME_DIRECT_ONLY', 'Opponent was not found');
        await this.member(manager, conversationId, opponentId);
      }

      const open = await manager
        .getRepository(GameSession)
        .createQueryBuilder('game')
        .where('game.conversationId = :conversationId', { conversationId })
        .andWhere("game.status IN ('invited','active')")
        .setLock('pessimistic_write')
        .getOne();
      if (open) fail(409, 'GAME_ALREADY_OPEN', 'An open game already exists');
      const savedGame = await manager.getRepository(GameSession).save({
        conversationId,
        gameType,
        xUserId: userId,
        oUserId: opponentId,
        board: initialBoard(gameType),
      });

      const seqRows: { last_message_sequence: string }[] = await manager.query(
        `WITH updated AS (
           UPDATE conversations
           SET last_message_sequence = last_message_sequence + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING last_message_sequence
         )
         SELECT last_message_sequence FROM updated`,
        [conversationId],
      );
      const sequence = seqRows[0]?.last_message_sequence;
      let inviteMessage: Message | undefined;
      if (sequence) {
        const title = GAME_TITLES[gameType] ?? 'Trò chơi';
        const inviteText = isGroupGame
          ? `Đã mở bàn chơi nhóm "${title}" — Bấm vào để tham gia ngay!`
          : `Đã gửi lời mời chơi "${title}" — Bấm vào để chấp nhận & vào bàn!`;
        inviteMessage = await manager.getRepository(Message).save({
          conversationId,
          senderId: userId,
          clientMessageId: savedGame.id,
          sequence,
          type: 'text',
          body: `🎮 [GAME_INVITE:${gameType}:${savedGame.id}] ${inviteText}`,
          content: null,
        });
      }

      return { savedGame, inviteMessage };
    });

    if (game.inviteMessage) {
      const msg = game.inviteMessage;
      this.events.publish({
        name: 'message:created',
        conversationId,
        messageId: msg.id,
        payload: {
          id: msg.id,
          conversationId: msg.conversationId,
          senderId: msg.senderId,
          clientMessageId: msg.clientMessageId,
          sequence: msg.sequence,
          type: msg.type,
          body: msg.body,
          content: msg.content,
          createdAt: msg.createdAt,
          editedAt: msg.editedAt,
          deletedAt: msg.deletedAt,
          spam: null,
        },
      });
    }

    return this.publish(userId, game.savedGame);
  }

  private async update(
    userId: string,
    id: string,
    action: (game: GameSession) => void,
  ) {
    const game = await this.db.transaction(async (manager) => {
      const row = await manager
        .getRepository(GameSession)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!row) fail(404, 'GAME_NOT_FOUND', 'Game was not found');
      await this.member(manager, row.conversationId, userId);
      if (
        !GROUP_GAME_TYPES.has(row.gameType) &&
        row.xUserId !== userId &&
        row.oUserId !== userId
      ) {
        fail(404, 'GAME_NOT_FOUND', 'Game was not found');
      }
      action(row);
      row.updatedAt = new Date();
      return manager.getRepository(GameSession).save(row);
    });
    return this.publish(userId, game);
  }

  accept(userId: string, id: string) {
    return this.update(userId, id, (game) => {
      const isGroupGame = GROUP_GAME_TYPES.has(game.gameType);
      if (isGroupGame) {
        if (game.xUserId === userId)
          fail(
            403,
            'GAME_FORBIDDEN',
            'Waiting for another group member to join',
          );
        game.oUserId = userId;
      } else if (game.oUserId !== userId) {
        fail(403, 'GAME_FORBIDDEN', 'Only the invited player can accept');
      }
      if (game.status !== 'invited')
        fail(409, 'GAME_STATE_CONFLICT', 'Game invitation is no longer open');
      game.status = 'active';
      if (!game.board || game.board.length === 0) {
        game.board = initialBoard(game.gameType);
      }
    });
  }

  decline(userId: string, id: string) {
    return this.update(userId, id, (game) => {
      const isGroupGame = GROUP_GAME_TYPES.has(game.gameType);
      if (
        (!isGroupGame && game.oUserId !== userId && game.xUserId !== userId) ||
        game.status !== 'invited'
      )
        fail(409, 'GAME_STATE_CONFLICT', 'Game invitation is no longer open');
      game.status = 'declined';
      game.finishedAt = new Date();
    });
  }

  forfeit(userId: string, id: string) {
    return this.update(userId, id, (game) => {
      if (game.status !== 'active')
        fail(409, 'GAME_STATE_CONFLICT', 'Game is not active');
      this.timedOutGames.delete(game.id);
      game.status = 'forfeited';
      game.winnerId = game.xUserId === userId ? game.oUserId : game.xUserId;
      game.finishedAt = new Date();
    });
  }

  move(userId: string, id: string, cell: number, from?: number) {
    return this.update(userId, id, (game) => {
      if (game.status !== 'active')
        fail(409, 'GAME_STATE_CONFLICT', 'Game is not active');
      const isGroupGame = GROUP_GAME_TYPES.has(game.gameType);
      let mark: 'X' | 'O' | undefined;
      if (game.xUserId === userId) {
        mark = 'X';
      } else if (isGroupGame || game.oUserId === userId) {
        mark = 'O';
        if (isGroupGame && game.turn === 'O') {
          game.oUserId = userId;
        }
      }
      if (!mark || game.turn !== mark)
        fail(409, 'GAME_NOT_YOUR_TURN', 'It is not your turn');

      const dim = BOARD_DIMS[game.gameType];
      const maxCells = dim.rows * dim.columns;
      const board = [...(game.board ?? [])];

      const playerNum = mark === 'X' ? 1 : 2;
      const sign: 1 | -1 = mark === 'X' ? 1 : -1;
      const opponentId = mark === 'X' ? game.oUserId : game.xUserId;

      // 1. MEMORY MATCH (Lật hình trí nhớ 4x4)
      if (game.gameType === 'memory_match') {
        if (cell < 0 || cell >= 16)
          fail(400, 'GAME_CELL_INVALID', 'Invalid card');
        const firstPick = board[18] ?? -1;
        // Clear previous turn's mismatched pair if starting a new pick
        if (firstPick === -1 && (board[19] ?? -1) >= 0) {
          const misA = board[19]!;
          const misB = board[20]!;
          if (misA >= 0 && misA < 16 && (board[misA] ?? 0) > 10)
            board[misA] = 0;
          if (misB >= 0 && misB < 16 && (board[misB] ?? 0) > 10)
            board[misB] = 0;
          board[19] = -1;
          board[20] = -1;
        }
        if (board[cell] !== 0)
          fail(409, 'GAME_CELL_OCCUPIED', 'Card is already flipped');

        const secretVal = board[21 + cell] ?? 1;
        if (firstPick === -1) {
          board[cell] = secretVal + 10;
          board[18] = cell;
          game.board = board;
          return;
        }

        const firstVal = board[21 + firstPick] ?? 1;
        board[18] = -1;
        game.moveCount++;

        if (firstVal === secretVal) {
          // Matched pair!
          board[firstPick] = firstVal;
          board[cell] = secretVal;
          const scoreIdx = mark === 'X' ? 16 : 17;
          board[scoreIdx] = (board[scoreIdx] ?? 0) + 1;

          const totalPairs = (board[16] ?? 0) + (board[17] ?? 0);
          if (totalPairs >= 8) {
            game.finishedAt = new Date();
            if ((board[16] ?? 0) === (board[17] ?? 0)) {
              game.status = 'draw';
            } else {
              game.status = 'won';
              game.winnerId =
                (board[16] ?? 0) > (board[17] ?? 0)
                  ? game.xUserId
                  : game.oUserId;
            }
          }
          // Bonus turn on match!
        } else {
          // Mismatch: leave both visible (11..18) until next player's first click
          board[firstPick] = firstVal + 10;
          board[cell] = secretVal + 10;
          board[19] = firstPick;
          board[20] = cell;
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        game.board = board;
        return;
      }

      // 2. TREASURE HUNT (Săn kho báu né bom 6x6)
      if (game.gameType === 'treasure_hunt') {
        if (cell < 0 || cell >= 36)
          fail(400, 'GAME_CELL_INVALID', 'Invalid tile');
        if (board[cell] !== 0)
          fail(409, 'GAME_CELL_OCCUPIED', 'Tile already excavated');

        const secretVal = board[40 + cell] ?? 10;
        board[cell] = secretVal;
        const scoreIdx = mark === 'X' ? 36 : 37;
        const curScore = board[scoreIdx] ?? 0;

        if (secretVal === 30) {
          // Diamond (+4)
          board[scoreIdx] = curScore + 4;
          board[38] = Math.max(0, (board[38] ?? 1) - 1);
          board[39] = 2;
        } else if (secretVal === 20) {
          // Gold (+2)
          board[scoreIdx] = curScore + 2;
          board[38] = Math.max(0, (board[38] ?? 1) - 1);
          board[39] = 1;
        } else if (secretVal === -10) {
          // Bomb (-2)
          board[scoreIdx] = Math.max(0, curScore - 2);
          board[39] = -1;
        } else {
          // Radar clue (+1 exploration point)
          board[scoreIdx] = curScore + 1;
          board[39] = 0;
        }

        game.moveCount++;
        game.board = board;

        if ((board[38] ?? 0) <= 0 || game.moveCount >= 24) {
          const xScore = board[36] ?? 0;
          const oScore = board[37] ?? 0;
          game.finishedAt = new Date();
          if (xScore === oScore) {
            game.status = 'draw';
          } else {
            game.status = 'won';
            game.winnerId = xScore > oScore ? game.xUserId : game.oUserId;
          }
        } else {
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        return;
      }

      // 3. RPS SHOWDOWN (Oẳn Tù Tì Đại Chiến BO5)
      if (game.gameType === 'rps_showdown') {
        if (cell < 0 || cell > 2)
          fail(400, 'GAME_CELL_INVALID', 'Invalid hand choice');
        const choice = cell + 1; // 1=Rock, 2=Paper, 3=Scissors
        if (mark === 'X') {
          board[14] = 1;
          board[15] = choice;
          game.board = board;
          game.turn = 'O';
          return;
        }
        // O plays and resolves the round
        const xChoice = board[15] || 1;
        const oChoice = choice;
        const roundIdx = Math.min(4, board[12] ?? 0);
        board[2 + roundIdx * 2] = xChoice;
        board[2 + roundIdx * 2 + 1] = oChoice;
        board[14] = 0;
        board[15] = 0;
        game.moveCount++;

        let roundWinner = 0;
        if (xChoice !== oChoice) {
          const xWins =
            (xChoice === 1 && oChoice === 3) ||
            (xChoice === 2 && oChoice === 1) ||
            (xChoice === 3 && oChoice === 2);
          roundWinner = xWins ? 1 : 2;
          if (xWins) board[0] = (board[0] ?? 0) + 1;
          else board[1] = (board[1] ?? 0) + 1;
        }
        board[13] = roundWinner;
        const nextRound = roundIdx + 1;
        board[12] = nextRound;
        game.board = board;

        const xScore = board[0] ?? 0;
        const oScore = board[1] ?? 0;
        if (xScore >= 3 || oScore >= 3 || nextRound >= 5) {
          game.finishedAt = new Date();
          if (xScore === oScore) {
            game.status = 'draw';
          } else {
            game.status = 'won';
            game.winnerId = xScore > oScore ? game.xUserId : game.oUserId;
          }
        } else {
          game.turn = 'X';
        }
        return;
      }

      // 4. PIRATE ROULETTE (Hải Tặc Đâm Thùng 20 khe)
      if (game.gameType === 'pirate_roulette') {
        if (cell < 0 || cell >= 20)
          fail(400, 'GAME_CELL_INVALID', 'Invalid barrel slot');
        if (board[cell] !== 0)
          fail(409, 'GAME_CELL_OCCUPIED', 'Slot already used');

        const trapSlot = board[22] ?? 0;
        const bonusSlots = board.slice(23, 27);
        game.moveCount++;

        if (cell === trapSlot) {
          board[cell] = -9; // Triggered pirate pop-up!
          game.board = board;
          game.status = 'won';
          game.winnerId = opponentId;
          game.finishedAt = new Date();
          return;
        }

        const isBonus = bonusSlots.includes(cell);
        board[cell] = isBonus ? (mark === 'X' ? 3 : 4) : playerNum;
        const goldIdx = mark === 'X' ? 20 : 21;
        board[goldIdx] = (board[goldIdx] ?? 0) + (isBonus ? 25 : 10);
        game.board = board;
        game.turn = mark === 'X' ? 'O' : 'X';
        return;
      }

      // 5. SUDOKU DUEL (Giải Mã Sudoku Đôi 4x4)
      if (game.gameType === 'sudoku_duel') {
        if (
          from === undefined ||
          from < 0 ||
          from >= 16 ||
          cell < 1 ||
          cell > 4
        )
          fail(400, 'GAME_CELL_INVALID', 'Select an empty cell and number 1-4');
        if (board[from] !== 0)
          fail(409, 'GAME_CELL_OCCUPIED', 'Cell is already solved');

        const solutionVal = board[19 + from] ?? 1;
        const scoreIdx = mark === 'X' ? 16 : 17;
        game.moveCount++;

        if (cell === solutionVal) {
          board[from] = (mark === 'X' ? 10 : 20) + cell;
          board[scoreIdx] = (board[scoreIdx] ?? 0) + 2;
          board[18] = 1; // Correct!
        } else {
          board[scoreIdx] = Math.max(0, (board[scoreIdx] ?? 0) - 1);
          board[18] = -1; // Wrong guess
        }
        game.board = board;

        const remainingEmpty = board.slice(0, 16).filter((v) => v === 0).length;
        if (remainingEmpty === 0) {
          const xScore = board[16] ?? 0;
          const oScore = board[17] ?? 0;
          game.finishedAt = new Date();
          if (xScore === oScore) {
            game.status = 'draw';
          } else {
            game.status = 'won';
            game.winnerId = xScore > oScore ? game.xUserId : game.oUserId;
          }
        } else {
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        return;
      }

      // 6. GROUP BOMB PASS (Chuyền Bom Hẹn Giờ Nhóm — 16 dây)
      if (game.gameType === 'group_bomb_pass') {
        if (cell < 0 || cell >= 16)
          fail(400, 'GAME_CELL_INVALID', 'Invalid wire');
        if (board[cell] !== 0)
          fail(409, 'GAME_CELL_OCCUPIED', 'Wire already cut');

        const bombWire = board[18] ?? 0;
        const bonusWires = board.slice(19, 23);
        game.moveCount++;

        if (cell === bombWire) {
          board[cell] = -9;
          game.board = board;
          game.status = 'won';
          game.winnerId = opponentId;
          game.finishedAt = new Date();
          return;
        }

        const isBonus = bonusWires.includes(cell);
        board[cell] = isBonus ? (mark === 'X' ? 3 : 4) : playerNum;
        const scoreIdx = mark === 'X' ? 16 : 17;
        board[scoreIdx] = (board[scoreIdx] ?? 0) + (isBonus ? 25 : 10);
        game.board = board;
        game.turn = mark === 'X' ? 'O' : 'X';
        return;
      }

      // 7. GROUP TRUTH OR DARE (Sự Thật Hay Thử Thách Nhóm — 12 phong bì)
      if (game.gameType === 'group_truth_dare') {
        if (cell < 0 || cell >= 12)
          fail(400, 'GAME_CELL_INVALID', 'Invalid envelope');
        if (board[cell] !== 0)
          fail(409, 'GAME_CELL_OCCUPIED', 'Envelope already opened');

        const promptId = board[16 + cell] ?? 101;
        board[cell] = promptId;
        board[14] = promptId;
        board[15] = playerNum;
        const isDare = promptId >= 200;
        const scoreIdx = mark === 'X' ? 12 : 13;
        board[scoreIdx] = (board[scoreIdx] ?? 0) + (isDare ? 25 : 15);
        game.moveCount++;
        game.board = board;

        if (game.moveCount >= 8) {
          const xScore = board[12] ?? 0;
          const oScore = board[13] ?? 0;
          game.finishedAt = new Date();
          if (xScore === oScore) {
            game.status = 'draw';
          } else {
            game.status = 'won';
            game.winnerId = xScore > oScore ? game.xUserId : game.oUserId;
          }
        } else {
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        return;
      }

      // 8. GROUP LUCKY WHEEL (Đua Nhân Phẩm Nhóm — 16 hộp quà)
      if (game.gameType === 'group_lucky_wheel') {
        if (cell < 0 || cell >= 16)
          fail(400, 'GAME_CELL_INVALID', 'Invalid chest');
        if (board[cell] !== 0)
          fail(409, 'GAME_CELL_OCCUPIED', 'Chest already opened');

        const prize = board[19 + cell] ?? 10;
        board[cell] = prize;
        board[18] = prize;
        const scoreIdx = mark === 'X' ? 16 : 17;
        const delta = prize === 1 ? 0 : prize;
        board[scoreIdx] = Math.max(0, (board[scoreIdx] ?? 0) + delta);
        game.moveCount++;
        game.board = board;

        if (game.moveCount >= 10) {
          const xScore = board[16] ?? 0;
          const oScore = board[17] ?? 0;
          game.finishedAt = new Date();
          if (xScore === oScore) {
            game.status = 'draw';
          } else {
            game.status = 'won';
            game.winnerId = xScore > oScore ? game.xUserId : game.oUserId;
          }
        } else {
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        return;
      }

      // 9. GROUP SPY HUNT (Truy Tìm Gián Điệp Nhóm — 5x5)
      if (game.gameType === 'group_spy_hunt') {
        if (cell < 0 || cell >= 25)
          fail(400, 'GAME_CELL_INVALID', 'Invalid room');
        if (board[cell] !== 0)
          fail(409, 'GAME_CELL_OCCUPIED', 'Room already inspected');

        const secretVal = board[29 + cell] ?? 10;
        board[cell] = secretVal;
        const scoreIdx = mark === 'X' ? 25 : 26;
        const curScore = board[scoreIdx] ?? 0;

        if (secretVal === 30) {
          // Spy caught (+5)
          board[scoreIdx] = curScore + 5;
          board[27] = Math.max(0, (board[27] ?? 1) - 1);
          board[28] = 2;
        } else if (secretVal === 20) {
          // Secret file (+2)
          board[scoreIdx] = curScore + 2;
          board[27] = Math.max(0, (board[27] ?? 1) - 1);
          board[28] = 1;
        } else if (secretVal === -10) {
          // Alarm trap (-2)
          board[scoreIdx] = Math.max(0, curScore - 2);
          board[28] = -1;
        } else {
          // Radar (+1)
          board[scoreIdx] = curScore + 1;
          board[28] = 0;
        }

        game.moveCount++;
        game.board = board;

        if ((board[27] ?? 0) <= 0 || game.moveCount >= 18) {
          const xScore = board[25] ?? 0;
          const oScore = board[26] ?? 0;
          game.finishedAt = new Date();
          if (xScore === oScore) {
            game.status = 'draw';
          } else {
            game.status = 'won';
            game.winnerId = xScore > oScore ? game.xUserId : game.oUserId;
          }
        } else {
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        return;
      }

      // 10. GROUP HEIST VAULT (Phi Vụ Phá Két Sắt Nhóm — 4 ổ khóa)
      if (game.gameType === 'group_heist_vault') {
        if (
          from === undefined ||
          from < 0 ||
          from >= 4 ||
          cell < 1 ||
          cell > 4
        ) {
          fail(400, 'GAME_CELL_INVALID', 'Select a lock (0-3) and digit (1-4)');
        }
        if ((board[from] ?? 0) !== 0) {
          fail(409, 'GAME_CELL_OCCUPIED', 'Lock is already cracked');
        }

        const secretDigit = board[15 + from] ?? 1;
        const scoreIdx = mark === 'X' ? 12 : 13;
        board[8 + from] = cell;
        game.moveCount++;

        if (cell === secretDigit) {
          board[from] = (mark === 'X' ? 10 : 20) + cell;
          board[4 + from] = 2; // Cracked!
          board[scoreIdx] = (board[scoreIdx] ?? 0) + 30;
          board[14] = 1;
        } else {
          board[4 + from] = secretDigit > cell ? 1 : -1; // 1 = Higher ▲, -1 = Lower ▼
          board[scoreIdx] = (board[scoreIdx] ?? 0) + 5;
          board[14] = -1;
        }
        game.board = board;

        const allCracked = board.slice(0, 4).every((v) => v > 0);
        if (allCracked || game.moveCount >= 12) {
          const xScore = board[12] ?? 0;
          const oScore = board[13] ?? 0;
          game.finishedAt = new Date();
          if (xScore === oScore) {
            game.status = 'draw';
          } else {
            game.status = 'won';
            game.winnerId = xScore > oScore ? game.xUserId : game.oUserId;
          }
        } else {
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        return;
      }

      // 11. GROUP QUIZ ARENA (Đấu Trường Đố Vui Nhóm — 5 câu hỏi)
      if (game.gameType === 'group_quiz_arena') {
        if (cell < 0 || cell > 3)
          fail(400, 'GAME_CELL_INVALID', 'Invalid answer option');
        const step = board[2] ?? 0;
        if (step >= 5)
          fail(409, 'GAME_STATE_CONFLICT', 'All questions answered');

        const qIdx = board[3 + step] ?? 0;
        const correctOpt = GROUP_QUIZ_ANSWERS[qIdx] ?? 0;
        const isCorrect = cell === correctOpt;
        const scoreIdx = mark === 'X' ? 0 : 1;

        if (isCorrect) {
          board[scoreIdx] = (board[scoreIdx] ?? 0) + 20;
        }
        board[8] = qIdx;
        board[9] = cell;
        board[10] = isCorrect ? 1 : -1;
        board[11] = correctOpt;

        const nextStep = step + 1;
        board[2] = nextStep;
        game.moveCount++;
        game.board = board;

        if (nextStep >= 5) {
          const xScore = board[0] ?? 0;
          const oScore = board[1] ?? 0;
          game.finishedAt = new Date();
          if (xScore === oScore) {
            game.status = 'draw';
          } else {
            game.status = 'won';
            game.winnerId = xScore > oScore ? game.xUserId : game.oUserId;
          }
        } else {
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        return;
      }

      while (board.length < maxCells) board.push(0);

      if (game.gameType === 'othello') {
        const flips = getOthelloFlips(board, cell, playerNum);
        if (flips.length === 0)
          fail(400, 'GAME_CELL_INVALID', 'Move must flip at least one disc');
        board[cell] = playerNum;
        for (const idx of flips) board[idx] = playerNum;
        game.board = board;
        game.moveCount++;

        const nextMark = mark === 'X' ? 'O' : 'X';
        const nextNum = playerNum === 1 ? 2 : 1;
        if (hasAnyOthelloMove(board, nextNum)) {
          game.turn = nextMark;
        } else if (hasAnyOthelloMove(board, playerNum)) {
          game.turn = mark;
        } else {
          const xScore = board.filter((v) => v === 1).length;
          const oScore = board.filter((v) => v === 2).length;
          game.finishedAt = new Date();
          if (xScore === oScore) {
            game.status = 'draw';
          } else {
            game.status = 'won';
            game.winnerId = xScore > oScore ? game.xUserId : game.oUserId;
          }
        }
        return;
      }

      if (game.gameType === 'chess') {
        if (from === undefined || !isValidChessMove(board, from, cell, sign))
          fail(400, 'GAME_CELL_INVALID', 'Invalid chess move');
        const movingPiece = board[from]!;
        const capturedPiece = board[cell] ?? 0;
        const destRow = Math.floor(cell / 8);
        if (
          Math.abs(movingPiece) === 1 &&
          ((sign === 1 && destRow === 0) || (sign === -1 && destRow === 7))
        ) {
          board[cell] = 5 * sign;
        } else {
          board[cell] = movingPiece;
        }
        board[from] = 0;
        game.board = board;
        game.moveCount++;

        if (Math.abs(capturedPiece) === 6 || !board.includes(-6 * sign)) {
          game.status = 'won';
          game.winnerId = userId;
          game.finishedAt = new Date();
        } else {
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        return;
      }

      if (game.gameType === 'xiangqi') {
        if (from === undefined || !isValidXiangqiMove(board, from, cell, sign))
          fail(400, 'GAME_CELL_INVALID', 'Invalid xiangqi move');
        const capturedPiece = board[cell] ?? 0;
        board[cell] = board[from]!;
        board[from] = 0;
        game.board = board;
        game.moveCount++;

        if (Math.abs(capturedPiece) === 7 || !board.includes(-7 * sign)) {
          game.status = 'won';
          game.winnerId = userId;
          game.finishedAt = new Date();
        } else {
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        return;
      }

      if (game.gameType === 'checkers') {
        if (from === undefined || !isValidCheckersMove(board, from, cell, sign))
          fail(400, 'GAME_CELL_INVALID', 'Invalid checkers move');
        const movingPiece = board[from]!;
        const r1 = Math.floor(from / 8);
        const c1 = from % 8;
        const r2 = Math.floor(cell / 8);
        const c2 = cell % 8;

        if (Math.abs(r2 - r1) === 2) {
          const midIdx = ((r1 + r2) / 2) * 8 + (c1 + c2) / 2;
          board[midIdx] = 0;
        }
        if ((sign === 1 && r2 === 0) || (sign === -1 && r2 === 7)) {
          board[cell] = 2 * sign;
        } else {
          board[cell] = movingPiece;
        }
        board[from] = 0;
        game.board = board;
        game.moveCount++;

        const oppHasPieces = board.some((v) => Math.sign(v) === -sign);
        if (!oppHasPieces || !hasAnyCheckersMove(board, -sign as 1 | -1)) {
          game.status = 'won';
          game.winnerId = userId;
          game.finishedAt = new Date();
        } else {
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        return;
      }

      if (game.gameType === 'co_ganh') {
        if (
          from === undefined ||
          !isValidCoGanhMove(board, from, cell, playerNum)
        )
          fail(400, 'GAME_CELL_INVALID', 'Invalid Co Ganh move');
        board[cell] = playerNum;
        board[from] = 0;
        applyCoGanhCaptures(board, cell, playerNum);
        game.board = board;
        game.moveCount++;

        const oppNum = playerNum === 1 ? 2 : 1;
        if (!board.includes(oppNum)) {
          game.status = 'won';
          game.winnerId = userId;
          game.finishedAt = new Date();
        } else if (game.moveCount >= 120) {
          const xCount = board.filter((v) => v === 1).length;
          const oCount = board.filter((v) => v === 2).length;
          game.finishedAt = new Date();
          if (xCount === oCount) game.status = 'draw';
          else {
            game.status = 'won';
            game.winnerId = xCount > oCount ? userId : opponentId;
          }
        } else {
          game.turn = mark === 'X' ? 'O' : 'X';
        }
        return;
      }

      // Line games: caro, tic_tac_toe, connect_four
      let target = cell;
      if (game.gameType === 'connect_four') {
        const column = cell % dim.columns;
        target = -1;
        for (let row = dim.rows - 1; row >= 0; row--)
          if (!board[row * dim.columns + column]) {
            target = row * dim.columns + column;
            break;
          }
        if (target < 0) fail(409, 'GAME_COLUMN_FULL', 'Column is full');
      }
      if (target < 0 || target >= maxCells)
        fail(400, 'GAME_CELL_INVALID', 'Cell is outside the board');
      if (board[target])
        fail(409, 'GAME_CELL_OCCUPIED', 'Cell is already occupied');
      board[target] = playerNum;
      game.board = board;
      game.moveCount++;
      if (
        dim.win &&
        this.hasWon(board, target, playerNum, {
          rows: dim.rows,
          columns: dim.columns,
          win: dim.win,
        })
      ) {
        game.status = 'won';
        game.winnerId = userId;
        game.finishedAt = new Date();
      } else if (game.moveCount === maxCells) {
        game.status = 'draw';
        game.finishedAt = new Date();
      } else game.turn = mark === 'X' ? 'O' : 'X';
    });
  }

  private hasWon(
    board: number[],
    cell: number,
    mark: number,
    rule: { rows: number; columns: number; win: number },
  ) {
    const row = Math.floor(cell / rule.columns),
      col = cell % rule.columns;
    return [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ].some(([dr, dc]) => {
      let count = 1;
      for (const sign of [-1, 1])
        for (let step = 1; step < rule.win; step++) {
          const r = row + dr! * step * sign,
            c = col + dc! * step * sign;
          if (
            r < 0 ||
            r >= rule.rows ||
            c < 0 ||
            c >= rule.columns ||
            board[r * rule.columns + c] !== mark
          )
            break;
          count++;
        }
      return count >= rule.win;
    });
  }
}
