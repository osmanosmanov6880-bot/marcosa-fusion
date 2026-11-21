-- R161 staging-only signed webhook acceptance ledger.
-- Review-only reference for a DISPOSABLE PostgreSQL 17 CI fixture.
BEGIN;
CREATE ROLE marcosa_r161_webhook_receiver NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA marcosa_private TO marcosa_r161_webhook_receiver;
CREATE TABLE marcosa_private.r161_webhook_inbox(
 delivery_key text PRIMARY KEY CHECK(delivery_key~'^marcosa-r159-[0-9a-f]{64}$'),
 episode_id uuid NOT NULL REFERENCES public.marcosa_season_episodes(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 accepted_count integer NOT NULL DEFAULT 1 CHECK(accepted_count BETWEEN 1 AND 1000000000),
 UNIQUE(episode_id,recipient_id)
);
ALTER TABLE marcosa_private.r161_webhook_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marcosa_private.r161_webhook_inbox FROM PUBLIC,anon,authenticated,
 marcosa_r156_writer,marcosa_r156_dispatcher,marcosa_r159_auth_reader;
GRANT SELECT,INSERT ON marcosa_private.r161_webhook_inbox TO marcosa_r161_webhook_receiver;
GRANT UPDATE(accepted_count) ON marcosa_private.r161_webhook_inbox TO marcosa_r161_webhook_receiver;
CREATE POLICY r161_inbox_receiver_select ON marcosa_private.r161_webhook_inbox
 FOR SELECT TO marcosa_r161_webhook_receiver USING (true);
CREATE POLICY r161_inbox_receiver_insert ON marcosa_private.r161_webhook_inbox
 FOR INSERT TO marcosa_r161_webhook_receiver WITH CHECK (true);
CREATE POLICY r161_inbox_receiver_update ON marcosa_private.r161_webhook_inbox
 FOR UPDATE TO marcosa_r161_webhook_receiver USING (true) WITH CHECK (true);
COMMENT ON TABLE marcosa_private.r161_webhook_inbox IS
 'Staging-only signed webhook receipt, no external delivery or user content. R161';
COMMIT;
