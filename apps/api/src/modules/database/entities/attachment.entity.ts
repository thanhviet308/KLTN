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
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { ConversationMember } from './conversation-member.entity';
import { Message } from './message.entity';
import { messageTextTransformer } from '../message-encryption';

@Entity('attachments')
@Unique('attachments_client_request', ['uploaderId', 'clientRequestId'])
@Check(
  'attachments_status_valid',
  "status IN ('pending', 'uploaded', 'attached', 'rejected', 'expired')",
)
@Check('attachments_size_valid', 'size > 0 AND size <= 104857600')
@Check(
  'attachments_metadata_valid',
  "LEN(trim(object_key)) > 0 AND LEN(trim(file_name)) > 0 AND CHARINDEX('/', mime_type) > 1",
)
@Check(
  'attachments_message_state',
  "(status = 'attached' AND message_id IS NOT NULL) OR (status <> 'attached' AND message_id IS NULL)",
)
@Check(
  'attachments_completion_state',
  "(status = 'pending' AND completed_at IS NULL) OR (status IN ('uploaded', 'attached') AND completed_at IS NOT NULL) OR status IN ('rejected', 'expired')",
)
@Check(
  'attachments_times',
  'upload_expires_at > created_at AND (completed_at IS NULL OR completed_at >= created_at)',
)
@Index('attachments_uploader_status_idx', ['uploaderId', 'status'])
@Index('attachments_message_idx', ['conversationId', 'messageId'])
@Index('attachments_pending_expiry_idx', ['uploadExpiresAt'], {
  where: "status = 'pending'",
})
export class Attachment {
  @Column({ name: 'client_request_id', type: 'uniqueidentifier' })
  clientRequestId!: string;
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'conversation_id', type: 'uniqueidentifier' })
  conversationId!: string;
  @Column({ name: 'uploader_id', type: 'uniqueidentifier' })
  uploaderId!: string;
  @ManyToOne(() => ConversationMember, {
    nullable: false,
    onDelete: 'NO ACTION',
  })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'uploader_id', referencedColumnName: 'userId' },
  ])
  uploaderMember!: Relation<ConversationMember>;
  @Column({ name: 'message_id', type: 'uniqueidentifier', nullable: true })
  messageId!: string | null;
  @ManyToOne(() => Message, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'uploader_id', referencedColumnName: 'senderId' },
    { name: 'message_id', referencedColumnName: 'id' },
  ])
  message!: Relation<Message> | null;
  @Column({
    name: 'object_key',
    type: 'nvarchar',
    length: 850,
    unique: true,
    select: false,
  })
  objectKey!: string;
  @Column({
    name: 'file_name',
    type: 'nvarchar',
    length: 'MAX',
    transformer: messageTextTransformer,
  })
  fileName!: string;
  @Column({ name: 'mime_type', type: 'nvarchar', length: 127 })
  mimeType!: string;
  @Column({ type: 'bigint' }) size!: string;
  @Column({ type: 'nvarchar', length: 16, default: 'pending' }) status!:
    'pending' | 'uploaded' | 'attached' | 'rejected' | 'expired';
  @Column({ name: 'upload_expires_at', type: 'datetimeoffset' })
  uploadExpiresAt!: Date;
  @Column({ name: 'completed_at', type: 'datetimeoffset', nullable: true })
  completedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetimeoffset' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetimeoffset' })
  updatedAt!: Date;
}
