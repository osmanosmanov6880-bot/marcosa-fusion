-- MARCOSA R159 restored disposable PostgreSQL: revoked sessions stay revoked.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF current_database()<>'marcosa_r159_restored' THEN
  RAISE EXCEPTION 'R159 restore proof refused on unexpected database'; END IF;
 IF (SELECT count(*) FROM auth.sessions)<>1 OR
  EXISTS(SELECT 1 FROM auth.sessions WHERE id='15900000-0000-4159-8159-000000000502')
 THEN RAISE EXCEPTION 'R159 deleted Auth session reappeared'; END IF;
 IF (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='dead')<>1
 OR (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='pending')<>1
 THEN RAISE EXCEPTION 'R159 canceled lease state changed during restore'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_subscriptions WHERE muted=true AND user_id='15900000-0000-4159-8159-000000000002')<>1
 THEN RAISE EXCEPTION 'R159 consenting reader mute lost on restore'; END IF;
 IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid='auth.sessions'::regclass)
 THEN RAISE EXCEPTION 'R159 restored Auth RLS missing'; END IF;
 IF has_table_privilege('authenticated','auth.sessions','SELECT')
 OR has_table_privilege('anon','auth.sessions','SELECT')
 THEN RAISE EXCEPTION 'R159 restored Auth sessions readable from browser'; END IF;
END $$;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM count(*) FROM auth.sessions;
  RAISE EXCEPTION 'R159 restored browser can read sessions';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET ROLE marcosa_r159_auth_reader;
DO $$ BEGIN
 IF (SELECT count(*) FROM auth.sessions)<>1
 THEN RAISE EXCEPTION 'R159 restored session checker cannot read records'; END IF;
 IF EXISTS(SELECT 1 FROM auth.sessions WHERE user_id='15900000-0000-4159-8159-000000000002')
 THEN RAISE EXCEPTION 'R159 restored deleted session still valid'; END IF;
END $$;
RESET ROLE;
SELECT 'R159_PG17_DUMP_RESTORE_REVOKED_SESSION_AND_CONSENT=PASS' AS proof;
