import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Call } from './call.entity';
import { ConversationMember } from './conversation-member.entity';

@Entity('call_participants')
@Check(
  'call_participants_status_valid',
  "status IN ('invited', 'accepted', 'joined', 'left', 'rejected', 'missed', 'cancelled')",
)
@Check(
  'call_participants_state_times',
  "(status IN ('invited', 'accepted', 'rejected', 'missed', 'cancelled') AND joined_at IS NULL AND left_at IS NULL) OR (status = 'joined' AND joined_at IS NOT NULL AND left_at IS NULL) OR (status = 'left' AND joined_at IS NOT NULL AND left_at IS NOT NULL)",
)
@Check(
  'call_participants_times',
  'joined_at IS NULL OR (joined_at >= invited_at AND (left_at IS NULL OR left_at >= joined_at))',
)
@Index('call_participants_user_history_idx', ['userId', 'invitedAt'])
@Index('call_participants_member_idx', ['conversationId', 'userId'])
export class CallParticipant {
  @PrimaryColumn({ name: 'call_id', type: 'uuid' }) callId!: string;
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'conversation_id', type: 'uuid' }) conversationId!: string;
  @ManyToOne(() => Call, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'call_id', referencedColumnName: 'id' },
  ])
  call!: Relation<Call>;
  @ManyToOne(() => ConversationMember, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member!: Relation<ConversationMember>;
  @Column({ type: 'varchar', length: 16, default: 'invited' }) status!:
    | 'invited'
    | 'accepted'
    | 'joined'
    | 'left'
    | 'rejected'
    | 'missed'
    | 'cancelled';
  @CreateDateColumn({ name: 'invited_at', type: 'timestamptz' })
  invitedAt!: Date;
  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt!: Date | null;
  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt!: Date | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
