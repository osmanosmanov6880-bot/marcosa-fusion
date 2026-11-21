-- R160 disposable PG17 backup/restore after signed TLS HTTP and logout.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database()<>'marcosa_r160_restored'
 THEN RAISE EXCEPTION 'R160 restore on unexpected database'; END IF;
 IF (SELECT revision FROM public.marcosa_seasons WHERE id=
  '15900000-0000-4159-8159-000000000301')<>1
 THEN RAISE EXCEPTION 'R160 restored revision mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.marcosa_seasons WHERE
  title='R160 TLS Verified Creator')
 THEN RAISE EXCEPTION 'R160 restored content missing'; END IF;
 IF EXISTS(SELECT 1 FROM auth.sessions WHERE id=
  '15900000-0000-4159-8159-000000000501')
 THEN RAISE EXCEPTION 'R160 restored revoked Auth session'; END IF;
 IF (SELECT count(*) FROM marcosa_private.r156_commands WHERE actor_id=
  '15900000-0000-4159-8159-000000000001')<>1
 THEN RAISE EXCEPTION 'R160 restored idempotency inconsistent'; END IF;
 IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid=
  'public.marcosa_seasons'::regclass)
 OR NOT(SELECT relrowsecurity FROM pg_class WHERE oid='auth.sessions'::regclass)
 THEN RAISE EXCEPTION 'R160 RLS disabled after restore'; END IF;
 IF has_table_privilege('authenticated','auth.sessions','SELECT')
 THEN RAISE EXCEPTION 'R160 Auth leaked to browser'; END IF;
END $$;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM count(*) FROM auth.sessions;
  RAISE EXCEPTION 'R160 authenticated could inspect Auth sessions';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SELECT 'R160_PG17_RESTORED_RLS_SIGNOUT_IDEMPOTENCY=PASS' AS proof;
