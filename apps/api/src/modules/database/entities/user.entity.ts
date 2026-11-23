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
  "email = lower(trim(email)) AND email NOT LIKE '%[' + CHAR(9) + CHAR(10) + CHAR(11) + CHAR(12) + CHAR(13) + ' ]%' AND CHARINDEX('@', email) > 1",
)
@Check('users_password_hash_present', 'LEN(trim(password_hash)) > 0')
@Check('users_display_name_present', 'LEN(trim(display_name)) > 0')
@Check('users_role_valid', "role IN ('user', 'admin')")
@Check('users_status_valid', "status IN ('active', 'blocked', 'deleted')")
export class User {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'nvarchar', length: 254, unique: true }) email!: string;
  @Column({
    name: 'password_hash',
    type: 'nvarchar',
    length: 'MAX',
    select: false,
  })
  passwordHash!: string;
  @Column({ name: 'last_active_at', type: 'datetimeoffset', nullable: true })
  lastActiveAt!: Date | null;
  @Column({ name: 'display_name', type: 'nvarchar', length: 100 })
  displayName!: string;
  @Column({
    name: 'avatar_key',
    type: 'nvarchar',
    length: 'MAX',
    nullable: true,
  })
  avatarKey!: string | null;
  @Column({ type: 'nvarchar', length: 16, default: 'user' }) role!:
    'user' | 'admin';
  @Column({ type: 'nvarchar', length: 16, default: 'active' }) status!:
    'active' | 'blocked' | 'deleted';
  @CreateDateColumn({ name: 'created_at', type: 'datetimeoffset' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetimeoffset' })
  updatedAt!: Date;
}
