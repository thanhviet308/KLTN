import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { ArcadeGameType } from '../database/entities/game-session.entity';

export const ARCADE_GAME_TYPES: ArcadeGameType[] = [
  'caro',
  'tic_tac_toe',
  'connect_four',
  'chess',
  'xiangqi',
  'othello',
  'checkers',
  'co_ganh',
  'memory_match',
  'treasure_hunt',
  'rps_showdown',
  'pirate_roulette',
  'sudoku_duel',
  'group_bomb_pass',
  'group_truth_dare',
  'group_lucky_wheel',
  'group_spy_hunt',
  'group_heist_vault',
  'group_quiz_arena',
];

export class CreateGameDto {
  @IsIn(ARCADE_GAME_TYPES)
  gameType!: ArcadeGameType;
}

export class GameMoveDto {
  @IsInt()
  @Min(0)
  @Max(224)
  cell!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(224)
  from?: number;
}
