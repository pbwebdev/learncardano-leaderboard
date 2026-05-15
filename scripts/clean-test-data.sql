-- ────────────────────────────────────────────────────────────────────────────
-- Remove the visual-design seed data shipped by scripts/seed-test-data.sql.
--
-- Apply locally:   wrangler d1 execute DB --file=scripts/clean-test-data.sql
-- Apply remotely:  wrangler d1 execute DB --remote --file=scripts/clean-test-data.sql
-- ────────────────────────────────────────────────────────────────────────────

DELETE FROM points_ledger WHERE user_id LIKE 'stake1uxtest%';
DELETE FROM submissions   WHERE user_id LIKE 'stake1uxtest%';
DELETE FROM click_events  WHERE user_id LIKE 'stake1uxtest%';
DELETE FROM tracked_links WHERE project_id LIKE 'test-%';
DELETE FROM audit_log     WHERE user_id LIKE 'stake1uxtest%' OR entity_id LIKE 'test-%';
DELETE FROM tasks         WHERE project_id LIKE 'test-%';
DELETE FROM projects      WHERE id LIKE 'test-%';
DELETE FROM users         WHERE stake_address LIKE 'stake1uxtest%';
