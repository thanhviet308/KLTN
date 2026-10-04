import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
@Check(
  'users_email_normalized',
  "email = lower(btrim(email)) AND email !~ '[[:space:]]' AND position('@' IN email) > 1",
)
@Check('users_password_hash_present', 'length(btrim(password_hash)) > 0')
@Check('users_display_name_present', 'length(btrim(display_name)) > 0')
@Check('users_role_valid', "role IN ('user', 'admin')")
@Check('users_status_valid', "status IN ('active', 'blocked', 'deleted')")
export class User {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 254, unique: true }) email!: string;
  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash!: string;
  @Column({ name: 'display_name', type: 'varchar', length: 100 })
  displayName!: string;
  @Column({ name: 'avatar_key', type: 'text', nullable: true }) avatarKey!:
    string | null;
  @Column({ type: 'varchar', length: 16, default: 'user' }) role!:
    'user' | 'admin';
  @Column({ type: 'varchar', length: 16, default: 'active' }) status!:
    'active' | 'blocked' | 'deleted';
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
