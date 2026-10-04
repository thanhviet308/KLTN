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
import { ConversationMember } from './conversation-member.entity';

@Entity('conversation_member_periods')
@Check('member_period_join_sequence', 'joined_after_sequence >= 0')
@Check('member_period_times', 'left_at IS NULL OR left_at >= joined_at')
@Check(
  'member_period_boundary',
  '(left_at IS NULL AND left_after_sequence IS NULL) OR (left_at IS NOT NULL AND left_after_sequence IS NOT NULL AND left_after_sequence >= joined_after_sequence)',
)
@Index('member_periods_one_active_idx', ['conversationId', 'userId'], {
  unique: true,
  where: 'left_at IS NULL',
})
@Index('member_periods_history_idx', ['conversationId', 'userId', 'joinedAt'])
@Index('member_periods_active_user_idx', ['userId', 'conversationId'], {
  where: 'left_at IS NULL',
})
export class ConversationMemberPeriod {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'conversation_id', type: 'uuid' }) conversationId!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => ConversationMember, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member!: Relation<ConversationMember>;
  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' }) joinedAt!: Date;
  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt!: Date | null;
  @Column({ name: 'joined_after_sequence', type: 'bigint', default: '0' })
  joinedAfterSequence!: string;
  @Column({ name: 'left_after_sequence', type: 'bigint', nullable: true })
  leftAfterSequence!: string | null;
}
