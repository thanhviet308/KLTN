import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Message } from './message.entity';
import { ConversationMember } from './conversation-member.entity';

@Entity('message_receipts')
@Check('receipts_read_time', 'read_at IS NULL OR read_at >= delivered_at')
@Index('receipts_member_idx', ['conversationId', 'userId'])
export class MessageReceipt {
  @Column({ name: 'conversation_id', type: 'uniqueidentifier' })
  conversationId!: string;
  @PrimaryColumn({ name: 'message_id', type: 'uniqueidentifier' })
  messageId!: string;
  @PrimaryColumn({ name: 'user_id', type: 'uniqueidentifier' }) userId!: string;
  @ManyToOne(() => Message, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'message_id', referencedColumnName: 'id' },
  ])
  message!: Relation<Message>;
  @ManyToOne(() => ConversationMember, {
    nullable: false,
    onDelete: 'NO ACTION',
  })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member!: Relation<ConversationMember>;
  @CreateDateColumn({ name: 'delivered_at', type: 'datetimeoffset' })
  deliveredAt!: Date;
  @Column({ name: 'read_at', type: 'datetimeoffset', nullable: true })
  readAt!: Date | null;
}
