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
@Check('device_tokens_token_size', 'DATALENGTH(token) <= 2048')
@Check('device_tokens_platform_valid', "platform IN ('web', 'android')")
@Check('device_tokens_token_present', 'LEN(trim(token)) > 0')
@Check(
  'device_tokens_revocation_time',
  'revoked_at IS NULL OR revoked_at >= created_at',
)
@Index('device_tokens_active_user_idx', ['userId'], {
  where: 'revoked_at IS NULL',
})
export class DeviceToken {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uniqueidentifier' }) userId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
  @Column({ type: 'nvarchar', length: 16 }) platform!: 'web' | 'android';
  @Column({ type: 'nvarchar', length: 850, unique: true, select: false })
  token!: string;
  @Column({ name: 'revoked_at', type: 'datetimeoffset', nullable: true })
  revokedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetimeoffset' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetimeoffset' })
  updatedAt!: Date;
}
