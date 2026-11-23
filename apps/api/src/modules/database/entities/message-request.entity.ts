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
@Check('message_requests_body_present', 'LEN(body) > 0')
@Index('message_requests_pair_idx', ['pairLowId', 'pairHighId'], {
  unique: true,
})
@Index('message_requests_recipient_status_idx', ['recipientId', 'status'])
@Index('message_requests_requester_status_idx', ['requesterId', 'status'])
export class MessageRequest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'requester_id', type: 'uniqueidentifier' })
  requesterId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'requester_id' })
  requester!: Relation<User>;
  @Column({ name: 'recipient_id', type: 'uniqueidentifier' })
  recipientId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'recipient_id' })
  recipient!: Relation<User>;
  @Column({
    name: 'pair_low_id',
    type: 'uniqueidentifier',
  })
  pairLowId!: string;
  @Column({
    name: 'pair_high_id',
    type: 'uniqueidentifier',
  })
  pairHighId!: string;
  @Column({
    type: 'nvarchar',
    length: 'MAX',
    transformer: messageTextTransformer,
  })
  body!: string;
  @Column({ type: 'nvarchar', length: 16, default: 'pending' }) status!:
    'pending' | 'accepted' | 'rejected' | 'cancelled';
  @Column({ name: 'responded_at', type: 'datetimeoffset', nullable: true })
  respondedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetimeoffset' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetimeoffset' })
  updatedAt!: Date;
}
