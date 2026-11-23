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
  @Column({ name: 'requester_id', type: 'uniqueidentifier' })
  requesterId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'requester_id' })
  requester!: Relation<User>;
  @Column({ name: 'recipient_id', type: 'uniqueidentifier' })
  recipientId!: string;
  @ManyToOne(() => User, { nullable: false, onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'recipient_id' })
  recipient!: Relation<User>;
  @Column({
    name: 'pair_low_id',
    type: 'uniqueidentifier',
  })
  pairLowId!: string;
  @Column({
    name: 'pair_high_id',
    type: 'uniqueidentifier',
  })
  pairHighId!: string;
  @Column({ type: 'nvarchar', length: 16, default: 'pending' }) status!:
    'pending' | 'accepted' | 'rejected' | 'cancelled' | 'removed';
  @CreateDateColumn({ name: 'created_at', type: 'datetimeoffset' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetimeoffset' })
  updatedAt!: Date;
}
