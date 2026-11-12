import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UserNotes1794182400000 implements MigrationInterface {
  name = 'UserNotes1794182400000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE "user_notes" (
      "user_id" uuid NOT NULL,
      "body" character varying(80) NOT NULL,
      "music_title" character varying(120),
      "music_artist" character varying(120),
      "music_url" character varying(1000),
      "music_preview_url" character varying(1000),
      "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "user_notes_body_present" CHECK (length(btrim(body)) BETWEEN 1 AND 80),
      CONSTRAINT "user_notes_music_shape" CHECK ((music_title IS NULL AND music_artist IS NULL AND music_url IS NULL AND music_preview_url IS NULL) OR (music_title IS NOT NULL AND length(btrim(music_title)) BETWEEN 1 AND 120)),
      CONSTRAINT "user_notes_expiry_valid" CHECK (expires_at > created_at),
      CONSTRAINT "PK_user_notes" PRIMARY KEY ("user_id"),
      CONSTRAINT "FK_user_notes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await runner.query(
      'CREATE INDEX "user_notes_expiry_idx" ON "user_notes" ("expires_at")',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE "user_notes"');
  }
}
