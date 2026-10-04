import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Conversation } from './conversation.entity';
import { ConversationMember } from './conversation-member.entity';

@Entity('messages')
@Check('messages_sequence_valid', 'sequence > 0')
@Check('messages_type_valid', "type IN ('text', 'image', 'file')")
@Check(
  'messages_body_valid',
  "(type = 'text' AND body IS NOT NULL AND length(btrim(body)) > 0 AND char_length(body) <= 10000) OR (type IN ('image', 'file') AND (body IS NULL OR char_length(body) <= 10000))",
)
@Check('messages_edit_time', 'edited_at IS NULL OR edited_at >= created_at')
@Check('messages_delete_time', 'deleted_at IS NULL OR deleted_at >= created_at')
@Unique('messages_client_id', ['senderId', 'clientMessageId'])
@Unique('messages_conversation_sequence', ['conversationId', 'sequence'])
@Unique('messages_conversation_id', ['conversationId', 'id'])
@Unique('messages_conversation_sender_id', ['conversationId', 'senderId', 'id'])
@Index('messages_sender_idx', ['senderId'])
export class Message {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'conversation_id', type: 'uuid' }) conversationId!: string;
  @ManyToOne(() => Conversation, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Relation<Conversation>;
  @Column({ name: 'sender_id', type: 'uuid' }) senderId!: string;
  @ManyToOne(() => ConversationMember, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'sender_id', referencedColumnName: 'userId' },
  ])
  senderMember!: Relation<ConversationMember>;
  @Column({ name: 'client_message_id', type: 'uuid' }) clientMessageId!: string;
  @Column({ type: 'bigint' }) sequence!: string;
  @Column({ type: 'varchar', length: 16, default: 'text' }) type!:
    'text' | 'image' | 'file';
  @Column({ type: 'text', nullable: true }) body!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt!: Date | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
