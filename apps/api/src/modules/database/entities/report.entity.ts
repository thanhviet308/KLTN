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
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from './user.entity';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';
import { Call } from './call.entity';
import { Attachment } from './attachment.entity';

@Entity('reports')
@Check(
  'reports_target_valid',
  "(CASE WHEN reported_user_id IS NULL THEN 0 ELSE 1 END + CASE WHEN reported_conversation_id IS NULL THEN 0 ELSE 1 END + CASE WHEN reported_message_id IS NULL THEN 0 ELSE 1 END + CASE WHEN reported_call_id IS NULL THEN 0 ELSE 1 END + CASE WHEN reported_attachment_id IS NULL THEN 0 ELSE 1 END) = 1 AND ((target_type = 'user' AND reported_user_id IS NOT NULL) OR (target_type = 'conversation' AND reported_conversation_id IS NOT NULL) OR (target_type = 'message' AND reported_message_id IS NOT NULL) OR (target_type = 'call' AND reported_call_id IS NOT NULL) OR (target_type = 'attachment' AND reported_attachment_id IS NOT NULL))",
)
@Check(
  'reports_status_valid',
  "status IN ('open', 'reviewing', 'resolved', 'dismissed')",
)
@Check('reports_reason_present', 'LEN(trim(reason)) > 0')
@Check(
  'reports_snapshot_valid',
  'ISJSON(snapshot, OBJECT) = 1 AND DATALENGTH(snapshot) <= 65536',
)
@Check(
  'reports_reviewer_separate',
  'reviewer_id IS NULL OR reviewer_id <> reporter_id',
)
@Check(
  'reports_review_state',
  "(status = 'open' AND reviewer_id IS NULL AND reviewed_at IS NULL AND resolution IS NULL) OR (status = 'reviewing' AND reviewer_id IS NOT NULL AND reviewed_at IS NULL AND resolution IS NULL) OR (status IN ('resolved', 'dismissed') AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND resolution IS NOT NULL AND LEN(trim(resolution)) > 0)",
)
@Check(
  'reports_review_time',
  'reviewed_at IS NULL OR reviewed_at >= created_at',
)
@Index(
  'reports_one_open_target_idx',
  ['reporterId', 'targetType', 'targetId'],
  { unique: true, where: "status IN ('open', 'reviewing')" },
)
@Index('reports_queue_idx', ['status', 'createdAt', 'id'])
@Index('reports_reviewer_idx', ['reviewerId'])
@Index('reports_user_target_idx', ['reportedUserId'])
@Index('reports_conversation_target_idx', ['reportedConversationId'])
@Index('reports_message_target_idx', ['reportedMessageId'])
@Index('reports_call_target_idx', ['reportedCallId'])
@Index('reports_attachment_target_idx', ['reportedAttachmentId'])
export class Report {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'reporter_id', type: 'uniqueidentifier' })
  reporterId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'reporter_id' })
  reporter!: Relation<User>;
  @Column({ name: 'target_type', type: 'nvarchar', length: 16 }) targetType!:
    'user' | 'conversation' | 'message' | 'call' | 'attachment';
  @Column({
    name: 'reported_user_id',
    type: 'uniqueidentifier',
    nullable: true,
  })
  reportedUserId!: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'reported_user_id' })
  reportedUser!: Relation<User> | null;
  @Column({
    name: 'reported_conversation_id',
    type: 'uniqueidentifier',
    nullable: true,
  })
  reportedConversationId!: string | null;
  @ManyToOne(() => Conversation, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'reported_conversation_id' })
  reportedConversation!: Relation<Conversation> | null;
  @Column({
    name: 'reported_message_id',
    type: 'uniqueidentifier',
    nullable: true,
  })
  reportedMessageId!: string | null;
  @ManyToOne(() => Message, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'reported_message_id' })
  reportedMessage!: Relation<Message> | null;
  @Column({
    name: 'reported_call_id',
    type: 'uniqueidentifier',
    nullable: true,
  })
  reportedCallId!: string | null;
  @ManyToOne(() => Call, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'reported_call_id' })
  reportedCall!: Relation<Call> | null;
  @Column({
    name: 'reported_attachment_id',
    type: 'uniqueidentifier',
    nullable: true,
  })
  reportedAttachmentId!: string | null;
  @ManyToOne(() => Attachment, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'reported_attachment_id' })
  reportedAttachment!: Relation<Attachment> | null;
  @Column({
    name: 'target_id',
    type: 'uniqueidentifier',
  })
  targetId!: string;
  @Column({ type: 'nvarchar', length: 2000 }) reason!: string;
  @Column({ type: 'nvarchar', length: 16, default: 'open' }) status!:
    'open' | 'reviewing' | 'resolved' | 'dismissed';
  @Column({ name: 'reviewer_id', type: 'uniqueidentifier', nullable: true })
  reviewerId!: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'reviewer_id' })
  reviewer!: Relation<User> | null;
  @Column({
    type: 'nvarchar',
    length: 'MAX',
    transformer: jsonColumn,
    default: () => "'{}'",
    select: false,
  })
  snapshot!: Record<string, unknown>;
  @Column({ type: 'nvarchar', length: 2000, nullable: true }) resolution!:
    string | null;
  @Column({ name: 'reviewed_at', type: 'datetimeoffset', nullable: true })
  reviewedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetimeoffset' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetimeoffset' })
  updatedAt!: Date;
}
