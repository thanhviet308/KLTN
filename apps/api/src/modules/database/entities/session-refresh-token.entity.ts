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
import { Session } from './session.entity';

@Entity('session_refresh_tokens')
@Check('refresh_tokens_hash_valid', "token_hash ~ '^[0-9a-f]{64}$'")
@Check('refresh_tokens_expiry', 'expires_at > created_at')
@Check(
  'refresh_tokens_consumption',
  'consumed_at IS NULL OR consumed_at >= created_at',
)
@Index('refresh_tokens_session_idx', ['sessionId'])
@Index('refresh_tokens_one_current_idx', ['sessionId'], {
  unique: true,
  where: 'consumed_at IS NULL',
})
export class SessionRefreshToken {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'session_id', type: 'uuid' }) sessionId!: string;
  @ManyToOne(() => Session, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session!: Relation<Session>;
  @Column({
    name: 'token_hash',
    type: 'varchar',
    length: 64,
    unique: true,
    select: false,
  })
  tokenHash!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}
