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

@Entity('conversations')
@Check('conversations_type_valid', "type IN ('direct', 'group')")
@Check('conversations_sequence_valid', 'last_message_sequence >= 0')
@Check(
  'conversations_shape',
  `(type = 'direct' AND title IS NULL AND direct_user_low_id IS NOT NULL AND direct_user_high_id IS NOT NULL AND CONVERT(char(36), direct_user_low_id) < CONVERT(char(36), direct_user_high_id) AND creator_id IN (direct_user_low_id, direct_user_high_id)) OR (type = 'group' AND direct_user_low_id IS NULL AND direct_user_high_id IS NULL AND title IS NOT NULL AND LEN(trim(title)) > 0)`,
)
@Index('conversations_direct_pair', ['directUserLowId', 'directUserHighId'], {
  unique: true,
  where: 'direct_user_low_id IS NOT NULL AND direct_user_high_id IS NOT NULL',
})
@Index('conversations_creator_request', ['creatorId', 'clientRequestId'], {
  unique: true,
  where: 'client_request_id IS NOT NULL',
})
@Check(
  'conversations_request_shape',
  "(type = 'direct' AND client_request_id IS NULL AND creation_fingerprint IS NULL) OR (type = 'group' AND ((client_request_id IS NULL AND creation_fingerprint IS NULL) OR (client_request_id IS NOT NULL AND LEN(creation_fingerprint) = 64 AND creation_fingerprint COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^0-9a-f]%')))",
)
@Index('conversations_creator_idx', ['creatorId'])
@Index('conversations_direct_high_idx', ['directUserHighId'], {
  where: "type = 'direct'",
})
export class Conversation {
  @Column({
    name: 'client_request_id',
    type: 'uniqueidentifier',
    nullable: true,
  })
  clientRequestId!: string | null;
  @Column({
    name: 'creation_fingerprint',
    type: 'nvarchar',
    length: 64,
    nullable: true,
    select: false,
  })
  creationFingerprint!: string | null;
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'nvarchar', length: 24, default: 'default' })
  background!: string;
  @Column({
    type: 'nvarchar',
    length: 'MAX',
    transformer: jsonColumn,
    default: () => "'{}'",
  })
  nicknames!: Record<string, string>;
  @Column({ type: 'nvarchar', length: 16 }) type!: 'direct' | 'group';
  @Column({ type: 'nvarchar', length: 200, nullable: true }) title!:
    string | null;
  @Column({ name: 'creator_id', type: 'uniqueidentifier' }) creatorId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'creator_id' })
  creator!: Relation<User>;
  @Column({
    name: 'direct_user_low_id',
    type: 'uniqueidentifier',
    nullable: true,
  })
  directUserLowId!: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'direct_user_low_id' })
  directUserLow!: Relation<User> | null;
  @Column({
    name: 'direct_user_high_id',
    type: 'uniqueidentifier',
    nullable: true,
  })
  directUserHighId!: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'direct_user_high_id' })
  directUserHigh!: Relation<User> | null;
  // SQL bigint is intentionally represented as string, never JS number.
  @Column({ name: 'last_message_sequence', type: 'bigint', default: '0' })
  lastMessageSequence!: string;
  @CreateDateColumn({ name: 'created_at', type: 'datetimeoffset' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetimeoffset' })
  updatedAt!: Date;
  @Column({ name: 'deleted_at', type: 'datetimeoffset', nullable: true })
  deletedAt!: Date | null;
}
