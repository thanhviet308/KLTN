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
import { User } from './user.entity';

@Entity('conversations')
@Check('conversations_type_valid', "type IN ('direct', 'group')")
@Check('conversations_sequence_valid', 'last_message_sequence >= 0')
@Check(
  'conversations_shape',
  `(type = 'direct' AND title IS NULL AND direct_user_low_id IS NOT NULL AND direct_user_high_id IS NOT NULL AND direct_user_low_id < direct_user_high_id AND creator_id IN (direct_user_low_id, direct_user_high_id)) OR (type = 'group' AND direct_user_low_id IS NULL AND direct_user_high_id IS NULL AND title IS NOT NULL AND length(btrim(title)) > 0)`,
)
@Unique('conversations_direct_pair', ['directUserLowId', 'directUserHighId'])
@Index('conversations_creator_idx', ['creatorId'])
@Index('conversations_direct_high_idx', ['directUserHighId'], {
  where: "type = 'direct'",
})
export class Conversation {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 16 }) type!: 'direct' | 'group';
  @Column({ type: 'varchar', length: 200, nullable: true }) title!:
    string | null;
  @Column({ name: 'creator_id', type: 'uuid' }) creatorId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'creator_id' })
  creator!: Relation<User>;
  @Column({ name: 'direct_user_low_id', type: 'uuid', nullable: true })
  directUserLowId!: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'direct_user_low_id' })
  directUserLow!: Relation<User> | null;
  @Column({ name: 'direct_user_high_id', type: 'uuid', nullable: true })
  directUserHighId!: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'direct_user_high_id' })
  directUserHigh!: Relation<User> | null;
  // PostgreSQL bigint is intentionally represented as string, never JS number.
  @Column({ name: 'last_message_sequence', type: 'bigint', default: '0' })
  lastMessageSequence!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
