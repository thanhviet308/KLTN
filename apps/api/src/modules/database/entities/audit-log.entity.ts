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
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from './user.entity';

@Entity('audit_logs')
@Check('audit_logs_action_present', 'LEN(trim(action)) > 0')
@Check(
  'audit_logs_target_pair',
  '(target_type IS NULL AND target_id IS NULL) OR (target_type IS NOT NULL AND LEN(trim(target_type)) > 0 AND target_id IS NOT NULL)',
)
@Check(
  'audit_logs_metadata_valid',
  'ISJSON(metadata, OBJECT) = 1 AND DATALENGTH(metadata) <= 16384',
)
@Index('audit_logs_actor_cursor_idx', ['actorId', 'createdAt', 'id'])
@Index('audit_logs_target_idx', ['targetType', 'targetId', 'createdAt'])
@Index('audit_logs_created_idx', ['createdAt', 'id'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'actor_id', type: 'uniqueidentifier', nullable: true })
  actorId!: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'actor_id' })
  actor!: Relation<User> | null;
  @Column({ type: 'nvarchar', length: 100 }) action!: string;
  // Historical reference intentionally survives target deletion; not a live FK.
  @Column({ name: 'target_type', type: 'nvarchar', length: 32, nullable: true })
  targetType!: string | null;
  @Column({ name: 'target_id', type: 'uniqueidentifier', nullable: true })
  targetId!: string | null;
  @Column({ name: 'request_id', type: 'uniqueidentifier', nullable: true })
  requestId!: string | null;
  @Column({
    type: 'nvarchar',
    length: 'MAX',
    transformer: jsonColumn,
    default: () => "'{}'",
    select: false,
  })
  metadata!: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'datetimeoffset' })
  createdAt!: Date;
}
