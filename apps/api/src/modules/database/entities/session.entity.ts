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

@Entity('sessions')
@Check('sessions_expiry', 'expires_at > created_at')
@Check('sessions_revocation', 'revoked_at IS NULL OR revoked_at >= created_at')
@Index('sessions_active_user_idx', ['userId', 'expiresAt'], {
  where: 'revoked_at IS NULL',
})
@Index('sessions_expiry_idx', ['expiresAt'])
export class Session {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
  @Column({ name: 'device_name', type: 'varchar', length: 200, nullable: true })
  deviceName!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
