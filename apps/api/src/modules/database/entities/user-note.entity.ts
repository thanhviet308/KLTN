import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from './user.entity';

@Entity('user_notes')
@Check('user_notes_body_present', 'length(btrim(body)) BETWEEN 1 AND 80')
@Check(
  'user_notes_music_shape',
  '(music_title IS NULL AND music_artist IS NULL AND music_url IS NULL AND music_preview_url IS NULL) OR (music_title IS NOT NULL AND length(btrim(music_title)) BETWEEN 1 AND 120)',
)
@Check('user_notes_expiry_valid', 'expires_at > created_at')
@Index('user_notes_expiry_idx', ['expiresAt'])
export class UserNote {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId!: string;
  @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;
  @Column({ type: 'varchar', length: 80 }) body!: string;
  @Column({ name: 'music_title', type: 'varchar', length: 120, nullable: true })
  musicTitle!: string | null;
  @Column({
    name: 'music_artist',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  musicArtist!: string | null;
  @Column({ name: 'music_url', type: 'varchar', length: 1000, nullable: true })
  musicUrl!: string | null;
  @Column({
    name: 'music_preview_url',
    type: 'varchar',
    length: 1000,
    nullable: true,
  })
  musicPreviewUrl!: string | null;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
