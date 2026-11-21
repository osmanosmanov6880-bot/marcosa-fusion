-- R156 recovered synthetic PostgreSQL 17: RLS, dedupe, CAS, privacy, outbox.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF current_database()<>'marcosa_r156_restored'
 THEN RAISE EXCEPTION 'R156 refuses unexpected restore target'; END IF;
 IF (SELECT revision FROM public.marcosa_seasons WHERE id='15600000-0000-4156-8156-000000000301')<>5
 OR (SELECT revision FROM public.marcosa_seasons WHERE id='15600000-0000-4156-8156-000000000303')<>1
 THEN RAISE EXCEPTION 'R156 revisions corrupted during restore'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_audit WHERE series_id=
  '15600000-0000-4156-8156-000000000301')<5
 THEN RAISE EXCEPTION 'R156 editorial history not restored'; END IF;
 IF (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='acked')<>1
 OR (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='leased')<>1
 THEN RAISE EXCEPTION 'R156 outbox state lost'; END IF;
 IF (SELECT count(*) FROM marcosa_private.r156_commands WHERE request_key IN
  ('15600000-0000-4156-8156-000000000904','15600000-0000-4156-8156-000000000906'))<>2
 THEN RAISE EXCEPTION 'R156 idempotency journal missing'; END IF;
 IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid='marcosa_private.r156_outbox'::regclass)
 OR has_function_privilege('authenticated','marcosa_private.r156_claim(text,integer,integer)','EXECUTE')
 OR has_function_privilege('anon',
  'marcosa_private.r156_edit_series(uuid,uuid,bigint,text,text,uuid)','EXECUTE')
 OR has_table_privilege('authenticated','marcosa_private.r156_commands','SELECT')
 THEN RAISE EXCEPTION 'R156 restored private access controls invalid'; END IF;
END $$;
SET ROLE anon;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_seasons WHERE slug='alice-r156-series')
 THEN RAISE EXCEPTION 'R156 archived season exposed to guest'; END IF;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000002',false);
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_season_bookmarks)
 OR EXISTS(SELECT 1 FROM public.marcosa_season_attendance)
 OR EXISTS(SELECT 1 FROM public.marcosa_season_subscriptions)
 OR EXISTS(SELECT 1 FROM public.marcosa_season_audit)
 THEN RAISE EXCEPTION 'R156 opted-out reader data or owner history resurrected'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000001',false);
DO $$
DECLARE previous jsonb;
BEGIN
 previous:=marcosa_private.r156_edit_series(
  '15600000-0000-4156-8156-000000000001',
  '15600000-0000-4156-8156-000000000301',0,
  'R156 safely edited','version one','15600000-0000-4156-8156-000000000904');
 IF previous->>'revision'<>'1' THEN RAISE EXCEPTION 'R156 restored idempotency response changed'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
SELECT 'R156 restored PG17 private ACL, author, reader, outbox and CAS PASS' AS proof;
