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
import { messageTextTransformer } from '../message-encryption';
import { User } from './user.entity';

@Entity('message_requests')
@Check('message_requests_distinct_users', 'requester_id <> recipient_id')
@Check(
  'message_requests_status_valid',
  "status IN ('pending', 'accepted', 'rejected', 'cancelled')",
)
@Check('message_requests_body_present', 'length(body) > 0')
@Index('message_requests_pair_idx', ['pairLowId', 'pairHighId'], {
  unique: true,
})
@Index('message_requests_recipient_status_idx', ['recipientId', 'status'])
@Index('message_requests_requester_status_idx', ['requesterId', 'status'])
export class MessageRequest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'requester_id', type: 'uuid' }) requesterId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requester_id' })
  requester!: Relation<User>;
  @Column({ name: 'recipient_id', type: 'uuid' }) recipientId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recipient_id' })
  recipient!: Relation<User>;
  @Column({
    name: 'pair_low_id',
    type: 'uuid',
    asExpression: 'LEAST(requester_id, recipient_id)',
    generatedType: 'STORED',
  })
  pairLowId!: string;
  @Column({
    name: 'pair_high_id',
    type: 'uuid',
    asExpression: 'GREATEST(requester_id, recipient_id)',
    generatedType: 'STORED',
  })
  pairHighId!: string;
  @Column({ type: 'text', transformer: messageTextTransformer }) body!: string;
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status!:
    'pending' | 'accepted' | 'rejected' | 'cancelled';
  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
