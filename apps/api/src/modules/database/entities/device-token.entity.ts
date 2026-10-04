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
import { User } from './user.entity';

@Entity('device_tokens')
@Check('device_tokens_token_size', 'octet_length(token) <= 2048')
@Check('device_tokens_platform_valid', "platform IN ('web', 'android')")
@Check('device_tokens_token_present', 'length(btrim(token)) > 0')
@Check(
  'device_tokens_revocation_time',
  'revoked_at IS NULL OR revoked_at >= created_at',
)
@Index('device_tokens_active_user_idx', ['userId'], {
  where: 'revoked_at IS NULL',
})
export class DeviceToken {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
  @Column({ type: 'varchar', length: 16 }) platform!: 'web' | 'android';
  @Column({ type: 'varchar', length: 4096, unique: true, select: false })
  token!: string;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
