import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('password_resets')
@Check('password_reset_email_normalized', 'email = lower(btrim(email))')
@Check(
  'password_reset_limits',
  'attempts BETWEEN 0 AND 5 AND send_count BETWEEN 1 AND 5',
)
export class PasswordReset {
  @PrimaryColumn({ type: 'varchar', length: 254 }) email!: string;
  @Column({ name: 'challenge_id', type: 'uuid', unique: true })
  challengeId!: string;
  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId!:
    string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;
  @Column({
    name: 'credential_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
    select: false,
  })
  credentialHash!: string | null;
  @Column({ name: 'code_hash', type: 'varchar', length: 64, select: false })
  codeHash!: string;
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ name: 'send_count', type: 'integer' }) sendCount!: number;
  @Column({ name: 'window_started_at', type: 'timestamptz' })
  windowStartedAt!: Date;
  @Column({ name: 'sent_at', type: 'timestamptz' }) sentAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
  @Column({ type: 'boolean', default: false }) delivered!: boolean;
}
