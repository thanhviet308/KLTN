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
import { Conversation } from './conversation.entity';
import { User } from './user.entity';
import { Message } from './message.entity';

@Entity('conversation_members')
@Check('members_role_valid', "role IN ('owner', 'admin', 'member')")
@Check(
  'members_read_sequence',
  'last_read_sequence IS NULL OR last_read_sequence > 0',
)
@Index('members_user_idx', ['userId', 'conversationId'])
export class ConversationMember {
  @PrimaryColumn({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => Conversation, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Relation<Conversation>;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
  @Column({ type: 'varchar', length: 16, default: 'member' }) role!:
    'owner' | 'admin' | 'member';
  @Column({ name: 'last_read_sequence', type: 'bigint', nullable: true })
  lastReadSequence!: string | null;
  @ManyToOne(() => Message, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'last_read_sequence', referencedColumnName: 'sequence' },
  ])
  lastReadMessage!: Relation<Message> | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
