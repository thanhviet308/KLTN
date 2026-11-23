import { jsonColumn } from '../json-column';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from './user.entity';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';

@Entity('ai_jobs')
@Check(
  'ai_jobs_error_code_valid',
  "error_code IS NULL OR LEN(error_code) BETWEEN 1 AND 64 AND error_code COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^A-Z0-9_]%'",
)
@Unique('ai_jobs_client_request', ['userId', 'clientRequestId'])
@Check('ai_jobs_kind_valid', "kind IN ('chat', 'summary', 'reply_suggestions')")
@Check(
  'ai_jobs_status_valid',
  "status IN ('queued', 'running', 'completed', 'failed', 'cancelled')",
)
@Check(
  'ai_jobs_range_valid',
  "(conversation_id IS NULL AND input_start_sequence IS NULL AND input_end_sequence IS NULL AND kind = 'chat') OR (conversation_id IS NOT NULL AND input_start_sequence IS NOT NULL AND input_end_sequence IS NOT NULL AND input_start_sequence > 0 AND input_end_sequence >= input_start_sequence)",
)
@Check(
  'ai_jobs_input_valid',
  'ISJSON(input, OBJECT) = 1 AND DATALENGTH(input) <= 65536',
)
@Check('ai_jobs_output_size', 'output IS NULL OR DATALENGTH(output) <= 1048576')
@Check(
  'ai_jobs_state_valid',
  "(status = 'queued' AND started_at IS NULL AND finished_at IS NULL AND output IS NULL AND error_code IS NULL) OR (status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL AND output IS NULL AND error_code IS NULL) OR (status = 'completed' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND output IS NOT NULL AND error_code IS NULL) OR (status = 'failed' AND finished_at IS NOT NULL AND output IS NULL AND error_code IS NOT NULL) OR (status = 'cancelled' AND finished_at IS NOT NULL AND output IS NULL)",
)
@Check(
  'ai_jobs_times',
  '(started_at IS NULL OR started_at >= created_at) AND (finished_at IS NULL OR finished_at >= created_at) AND (started_at IS NULL OR finished_at IS NULL OR finished_at >= started_at)',
)
@Index('ai_jobs_user_cursor_idx', ['userId', 'createdAt', 'id'])
@Index('ai_jobs_queue_idx', ['createdAt', 'id'], { where: "status = 'queued'" })
@Index('ai_jobs_conversation_idx', ['conversationId'])
export class AiJob {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uniqueidentifier' }) userId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
  @Column({ name: 'client_request_id', type: 'uniqueidentifier' })
  clientRequestId!: string;
  @Column({ name: 'conversation_id', type: 'uniqueidentifier', nullable: true })
  conversationId!: string | null;
  @ManyToOne(() => Conversation, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Relation<Conversation> | null;
  @Column({ type: 'nvarchar', length: 32 }) kind!:
    'chat' | 'summary' | 'reply_suggestions';
  @Column({ type: 'nvarchar', length: 16, default: 'queued' }) status!:
    'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  @Column({ name: 'input_start_sequence', type: 'bigint', nullable: true })
  inputStartSequence!: string | null;
  @ManyToOne(() => Message, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'input_start_sequence', referencedColumnName: 'sequence' },
  ])
  inputStartMessage!: Relation<Message> | null;
  @Column({ name: 'input_end_sequence', type: 'bigint', nullable: true })
  inputEndSequence!: string | null;
  @ManyToOne(() => Message, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'input_end_sequence', referencedColumnName: 'sequence' },
  ])
  inputEndMessage!: Relation<Message> | null;
  @Column({
    type: 'nvarchar',
    length: 'MAX',
    transformer: jsonColumn,
    default: () => "'{}'",
    select: false,
  })
  input!: Record<string, unknown>;
  @Column({ type: 'nvarchar', length: 'MAX', nullable: true, select: false })
  output!: string | null;
  @Column({ name: 'error_code', type: 'nvarchar', length: 64, nullable: true })
  errorCode!: string | null;
  @Column({ name: 'started_at', type: 'datetimeoffset', nullable: true })
  startedAt!: Date | null;
  @Column({ name: 'finished_at', type: 'datetimeoffset', nullable: true })
  finishedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetimeoffset' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetimeoffset' })
  updatedAt!: Date;
}
