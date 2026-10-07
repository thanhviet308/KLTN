import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FriendshipDirectConversations1791417600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Backfill only missing conversations; existing messages and memberships stay intact.
    await runner.query(`WITH created AS (
      INSERT INTO conversations (type, creator_id, direct_user_low_id, direct_user_high_id)
      SELECT 'direct', f.requester_id, LEAST(f.requester_id, f.recipient_id),
        GREATEST(f.requester_id, f.recipient_id)
      FROM friendships f
      JOIN users requester ON requester.id = f.requester_id AND requester.status = 'active'
      JOIN users recipient ON recipient.id = f.recipient_id AND recipient.status = 'active'
      WHERE f.status = 'accepted'
      ON CONFLICT (direct_user_low_id, direct_user_high_id) DO NOTHING
      RETURNING id, direct_user_low_id, direct_user_high_id
    ), members AS (
      INSERT INTO conversation_members (conversation_id, user_id, role)
      SELECT id, direct_user_low_id, 'member' FROM created
      UNION ALL
      SELECT id, direct_user_high_id, 'member' FROM created
      RETURNING conversation_id, user_id
    )
    INSERT INTO conversation_member_periods (conversation_id, user_id, joined_after_sequence)
    SELECT conversation_id, user_id, 0 FROM members`);
  }

  async down(): Promise<void> {
    // Preserve conversations: users may have sent messages since the backfill.
  }
}
