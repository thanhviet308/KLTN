import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('registration_verifications')
@Check('registration_email_normalized', 'email = lower(trim(email))')
@Check(
  'registration_attempts_valid',
  'attempts BETWEEN 0 AND 5 AND send_count BETWEEN 1 AND 5',
)
export class RegistrationVerification {
  @PrimaryColumn({ type: 'nvarchar', length: 254 }) email!: string;
  @Column({ name: 'challenge_id', type: 'uniqueidentifier', unique: true })
  challengeId!: string;
  @Column({ name: 'code_hash', type: 'nvarchar', length: 64, select: false })
  codeHash!: string;
  @Column({
    name: 'proof_hash',
    type: 'nvarchar',
    length: 64,
    nullable: true,
    select: false,
  })
  proofHash!: string | null;
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ name: 'send_count', type: 'integer' }) sendCount!: number;
  @Column({ name: 'window_started_at', type: 'datetimeoffset' })
  windowStartedAt!: Date;
  @Column({ name: 'sent_at', type: 'datetimeoffset' }) sentAt!: Date;
  @Column({ name: 'expires_at', type: 'datetimeoffset' }) expiresAt!: Date;
  @Column({ name: 'verified_at', type: 'datetimeoffset', nullable: true })
  verifiedAt!: Date | null;
  @Column({ name: 'consumed_at', type: 'datetimeoffset', nullable: true })
  consumedAt!: Date | null;
  @Column({ type: 'bit', default: false }) delivered!: boolean;
}
