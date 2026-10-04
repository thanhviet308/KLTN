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

@Entity('friendships')
@Check('friendships_distinct_users', 'requester_id <> recipient_id')
@Check(
  'friendships_status_valid',
  "status IN ('pending', 'accepted', 'rejected', 'cancelled', 'removed')",
)
@Index('friendships_pair_idx', ['pairLowId', 'pairHighId'], { unique: true })
@Index('friendships_requester_status_idx', ['requesterId', 'status'])
@Index('friendships_recipient_status_idx', ['recipientId', 'status'])
export class Friendship {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'requester_id', type: 'uuid' }) requesterId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requester_id' })
  requester!: Relation<User>;
  @Column({ name: 'recipient_id', type: 'uuid' }) recipientId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'recipient_id' })
  recipient!: Relation<User>;
  @Column({
    name: 'pair_low_id',
    type: 'uuid',
    asExpression: 'LEAST(requester_id, recipient_id)',
    generatedType: 'STORED',
  })
  pairLowId!: string;
  @Column({
    name: 'pair_high_id',
    type: 'uuid',
    asExpression: 'GREATEST(requester_id, recipient_id)',
    generatedType: 'STORED',
  })
  pairHighId!: string;
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status!:
    'pending' | 'accepted' | 'rejected' | 'cancelled' | 'removed';
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
