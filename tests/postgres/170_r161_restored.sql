-- R161 isolated PostgreSQL restored after HTTPS ingress + revoke and webhook inbox.
\set ON_ERROR_STOP on
DO $$
DECLARE n int;
BEGIN
 IF current_database()<>'marcosa_r161_restored'
 THEN RAISE EXCEPTION 'R161 restore refused unknown database'; END IF;
 IF (SELECT revision FROM public.marcosa_seasons WHERE id=
  '15900000-0000-4159-8159-000000000301')<>2
 THEN RAISE EXCEPTION 'R161 rollback or commit state mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.marcosa_seasons WHERE id=
  '15900000-0000-4159-8159-000000000301'
  AND title='R161 TLS + Fenced Session')
 THEN RAISE EXCEPTION 'R161 unauthorized data survived rollback'; END IF;
 IF EXISTS(SELECT 1 FROM auth.sessions WHERE id=
  '16100000-0000-4161-8161-000000000502')
 THEN RAISE EXCEPTION 'R161 revoked Auth session resurrected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=
  '16100000-0000-4161-8161-000000000501')
 THEN RAISE EXCEPTION 'R161 valid Auth session disappeared'; END IF;
 IF (SELECT count(*) FROM marcosa_private.r156_commands WHERE actor_id=
  '15900000-0000-4159-8159-000000000001')<>2
 THEN RAISE EXCEPTION 'R161 aborted transaction wrote idempotency log'; END IF;
 IF (SELECT count(*) FROM marcosa_private.r161_webhook_inbox)<>1
 OR (SELECT accepted_count FROM marcosa_private.r161_webhook_inbox)<>2
 THEN RAISE EXCEPTION 'R161 double webhook acceptance row mismatch'; END IF;
 IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid=
  'marcosa_private.r161_webhook_inbox'::regclass)
 THEN RAISE EXCEPTION 'R161 inbox restored without RLS'; END IF;
 IF has_table_privilege('authenticated','marcosa_private.r161_webhook_inbox','SELECT')
  OR has_table_privilege('anon','marcosa_private.r161_webhook_inbox','SELECT')
 THEN RAISE EXCEPTION 'R161 inbox leaked to browser'; END IF;
END $$;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.r161_webhook_inbox;
  RAISE EXCEPTION 'R161 browser queried inbox after restore';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SELECT 'R161_PG17_RESTORED_AUTH_ROLLBACK_INBOX_IDEMPOTENCY=PASS' AS proof;
