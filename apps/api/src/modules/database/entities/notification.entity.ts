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
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from './user.entity';

@Entity('notifications')
@Unique('notifications_dedupe', ['userId', 'deduplicationKey'])
@Check(
  'notifications_type_valid',
  "type IN ('friend_request', 'friend_accepted', 'message', 'call', 'ai_completed', 'ai_failed', 'report_updated')",
)
@Check(
  'notifications_payload_valid',
  "jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384",
)
@Check('notifications_read_time', 'read_at IS NULL OR read_at >= created_at')
@Check(
  'notifications_dedupe_present',
  'deduplication_key IS NULL OR length(btrim(deduplication_key)) > 0',
)
@Index('notifications_user_cursor_idx', ['userId', 'createdAt', 'id'])
@Index('notifications_unread_idx', ['userId', 'createdAt'], {
  where: 'read_at IS NULL',
})
export class Notification {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
  @Column({ type: 'varchar', length: 32 }) type!:
    | 'friend_request'
    | 'friend_accepted'
    | 'message'
    | 'call'
    | 'ai_completed'
    | 'ai_failed'
    | 'report_updated';
  @Column({ type: 'jsonb', default: {} }) payload!: Record<string, unknown>;
  @Column({
    name: 'deduplication_key',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  deduplicationKey!: string | null;
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
