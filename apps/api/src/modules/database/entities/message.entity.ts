import { jsonColumn } from '../json-column';
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
import {
  messageContentTransformer,
  messageTextTransformer,
} from '../message-encryption';

@Entity('messages')
@Check('messages_sequence_valid', 'sequence > 0')
@Check(
  'messages_type_valid',
  "type IN ('text', 'image', 'file', 'voice', 'location', 'call')",
)
@Check(
  'messages_body_valid',
  "(type = 'text' AND body IS NOT NULL) OR type IN ('image', 'file', 'voice', 'location', 'call')",
)
@Check('messages_edit_time', 'edited_at IS NULL OR edited_at >= created_at')
@Check('messages_delete_time', 'deleted_at IS NULL OR deleted_at >= created_at')
@Check('messages_edited_body_valid', "edited_body IS NULL OR type = 'text'")
@Check(
  'messages_edited_body_state',
  '(edited_at IS NULL AND edited_body IS NULL) OR (edited_at IS NOT NULL AND edited_body IS NOT NULL)',
)
@Unique('messages_client_id', ['senderId', 'clientMessageId'])
@Unique('messages_conversation_sequence', ['conversationId', 'sequence'])
@Unique('messages_conversation_id', ['conversationId', 'id'])
@Unique('messages_conversation_sender_id', ['conversationId', 'senderId', 'id'])
@Index('messages_sender_idx', ['senderId'])
export class Message {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'conversation_id', type: 'uniqueidentifier' })
  conversationId!: string;
  @ManyToOne(() => Conversation, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Relation<Conversation>;
  @Column({ name: 'sender_id', type: 'uniqueidentifier' }) senderId!: string;
  @ManyToOne(() => ConversationMember, {
    nullable: false,
    onDelete: 'NO ACTION',
  })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'sender_id', referencedColumnName: 'userId' },
  ])
  senderMember!: Relation<ConversationMember>;
  @Column({ name: 'client_message_id', type: 'uniqueidentifier' })
  clientMessageId!: string;
  @Column({ type: 'bigint' }) sequence!: string;
  @Column({ type: 'nvarchar', length: 16, default: 'text' }) type!:
    'text' | 'image' | 'file' | 'voice' | 'location' | 'call';
  @Column({
    type: 'nvarchar',
    length: 'MAX',
    nullable: true,
    transformer: [messageContentTransformer, jsonColumn],
  })
  content!: {
    mentions?: string[];
    forwarded?: boolean;
    latitude?: number;
    longitude?: number;
    attachmentId?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    sha256?: string;
    callId?: string;
    callType?: 'audio' | 'video';
    callStatus?: 'ended' | 'rejected' | 'missed' | 'cancelled';
    durationSeconds?: number;
    summaryAvailable?: boolean;
    replyTo?: {
      messageId: string;
      senderId: string;
      type:
        'text' | 'image' | 'file' | 'voice' | 'location' | 'call' | 'deleted';
      excerpt: string;
    };
  } | null;
  @Column({
    type: 'nvarchar',
    length: 'MAX',
    nullable: true,
    transformer: messageTextTransformer,
  })
  body!: string | null;
  @Column({
    name: 'edited_body',
    type: 'nvarchar',
    length: 'MAX',
    nullable: true,
    transformer: messageTextTransformer,
  })
  editedBody!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetimeoffset' })
  createdAt!: Date;
  @Column({ name: 'edited_at', type: 'datetimeoffset', nullable: true })
  editedAt!: Date | null;
  @Column({ name: 'deleted_at', type: 'datetimeoffset', nullable: true })
  deletedAt!: Date | null;
  @Column({ name: 'spam_label', type: 'bit', nullable: true })
  spamLabel!: boolean | null;
  @Column({ name: 'spam_score', type: 'real', nullable: true })
  spamScore!: number | null;
  @Column({ name: 'spam_model', type: 'nvarchar', length: 100, nullable: true })
  spamModel!: string | null;
}
