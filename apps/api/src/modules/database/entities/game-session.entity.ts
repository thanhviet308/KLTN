import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Conversation } from './conversation.entity';
import { User } from './user.entity';

export type ArcadeGameType =
  | 'caro'
  | 'tic_tac_toe'
  | 'connect_four'
  | 'chess'
  | 'xiangqi'
  | 'othello'
  | 'checkers'
  | 'co_ganh'
  | 'memory_match'
  | 'treasure_hunt'
  | 'rps_showdown'
  | 'pirate_roulette'
  | 'sudoku_duel'
  | 'group_bomb_pass'
  | 'group_truth_dare'
  | 'group_lucky_wheel'
  | 'group_spy_hunt'
  | 'group_heist_vault'
  | 'group_quiz_arena';

@Entity('game_sessions')
@Check(
  'game_sessions_type_valid',
  "game_type IN ('caro', 'tic_tac_toe', 'connect_four', 'chess', 'xiangqi', 'othello', 'checkers', 'co_ganh', 'memory_match', 'treasure_hunt', 'rps_showdown', 'pirate_roulette', 'sudoku_duel', 'group_bomb_pass', 'group_truth_dare', 'group_lucky_wheel', 'group_spy_hunt', 'group_heist_vault', 'group_quiz_arena')",
)
@Check(
  'game_sessions_status_valid',
  "status IN ('invited', 'active', 'won', 'draw', 'declined', 'forfeited')",
)
@Check('game_sessions_players_distinct', 'x_user_id <> o_user_id')
@Check('game_sessions_turn_valid', "turn IN ('X', 'O')")
@Check(
  'game_sessions_winner_valid',
  'winner_id IS NULL OR winner_id IN (x_user_id, o_user_id)',
)
@Index('game_sessions_conversation_idx', ['conversationId', 'createdAt'])
@Index('game_sessions_one_open_idx', ['conversationId'], {
  unique: true,
  where: "status IN ('invited', 'active')",
})
export class GameSession {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'conversation_id', type: 'uuid' }) conversationId!: string;
  @ManyToOne(() => Conversation, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Relation<Conversation>;
  @Column({ name: 'game_type', type: 'varchar', length: 24, default: 'caro' })
  gameType!: ArcadeGameType;
  @Column({ name: 'x_user_id', type: 'uuid' }) xUserId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'x_user_id' })
  xUser!: Relation<User>;
  @Column({ name: 'o_user_id', type: 'uuid' }) oUserId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'o_user_id' })
  oUser!: Relation<User>;
  @Column({ type: 'varchar', length: 16, default: 'invited' })
  status!: 'invited' | 'active' | 'won' | 'draw' | 'declined' | 'forfeited';
  @Column({ type: 'varchar', length: 1, default: 'X' }) turn!: 'X' | 'O';
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) board!: number[];
  @Column({ name: 'winner_id', type: 'uuid', nullable: true })
  winnerId!: string | null;
  @Column({ name: 'move_count', type: 'integer', default: 0 })
  moveCount!: number;
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
