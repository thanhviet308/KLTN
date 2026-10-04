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

@Entity('calls')
@Unique('calls_client_request', ['initiatorId', 'clientRequestId'])
@Unique('calls_conversation_id', ['conversationId', 'id'])
@Check('calls_type_valid', "type IN ('audio', 'video')")
@Check(
  'calls_status_valid',
  "status IN ('ringing', 'active', 'ended', 'rejected', 'missed', 'cancelled')",
)
@Check('calls_room_present', 'length(btrim(room_name)) > 0')
@Check(
  'calls_state_times',
  "(status = 'ringing' AND started_at IS NULL AND ended_at IS NULL) OR (status = 'active' AND started_at IS NOT NULL AND ended_at IS NULL) OR (status = 'ended' AND started_at IS NOT NULL AND ended_at IS NOT NULL) OR (status IN ('rejected', 'missed', 'cancelled') AND started_at IS NULL AND ended_at IS NOT NULL)",
)
@Check(
  'calls_times_ordered',
  'ring_expires_at > created_at AND (started_at IS NULL OR started_at >= created_at) AND (ended_at IS NULL OR ended_at >= created_at) AND (started_at IS NULL OR ended_at IS NULL OR ended_at >= started_at)',
)
@Index('calls_one_open_idx', ['conversationId'], {
  unique: true,
  where: "status IN ('ringing', 'active')",
})
@Index('calls_conversation_history_idx', ['conversationId', 'createdAt', 'id'])
@Index('calls_initiator_idx', ['initiatorId'])
@Index('calls_ringing_expiry_idx', ['ringExpiresAt'], {
  where: "status = 'ringing'",
})
export class Call {
  @Column({ name: 'client_request_id', type: 'uuid' }) clientRequestId!: string;
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'conversation_id', type: 'uuid' }) conversationId!: string;
  @Column({ name: 'initiator_id', type: 'uuid' }) initiatorId!: string;
  @ManyToOne(() => ConversationMember, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId' },
    { name: 'initiator_id', referencedColumnName: 'userId' },
  ])
  initiatorMember!: Relation<ConversationMember>;
  @Column({ name: 'room_name', type: 'varchar', length: 200, unique: true })
  roomName!: string;
  @Column({ type: 'varchar', length: 16 }) type!: 'audio' | 'video';
  @Column({ type: 'varchar', length: 16, default: 'ringing' }) status!:
    'ringing' | 'active' | 'ended' | 'rejected' | 'missed' | 'cancelled';
  @Column({ name: 'ring_expires_at', type: 'timestamptz' })
  ringExpiresAt!: Date;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
