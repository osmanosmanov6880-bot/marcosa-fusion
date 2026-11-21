-- MARCOSA R158: post-restore identities and data, disposable only.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF current_database()<>'marcosa_r158_restored'
 THEN RAISE EXCEPTION 'R158 refuses unknown restore database'; END IF;
 IF (SELECT revision FROM public.marcosa_seasons WHERE id='15800000-0000-4158-8158-000000000301')<>5
 THEN RAISE EXCEPTION 'R158 restored revision mismatch'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_episodes WHERE series_id='15800000-0000-4158-8158-000000000301')<>2
 THEN RAISE EXCEPTION 'R158 restored episode count wrong'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_audit WHERE series_id='15800000-0000-4158-8158-000000000301')<>5
 THEN RAISE EXCEPTION 'R158 owner journal lost'; END IF;
 IF (SELECT count(*) FROM marcosa_private.r156_commands WHERE actor_id IN
  ('15800000-0000-4158-8158-000000000001','15800000-0000-4158-8158-000000000002'))<>10
 THEN RAISE EXCEPTION 'R158 leaked failed or dropped successful command'; END IF;
 IF EXISTS(SELECT 1 FROM marcosa_private.r156_outbox WHERE series_id='15800000-0000-4158-8158-000000000301' AND state<>'acked')
 THEN RAISE EXCEPTION 'R158 resurrected archived notifications'; END IF;
 IF NOT EXISTS(SELECT 1 FROM marcosa_private.r158_sessions
   WHERE session_id='15800000-0000-4158-8158-000000000502' AND revoked_at IS NOT NULL)
 THEN RAISE EXCEPTION 'R158 lost revocation during restore'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_attendance WHERE episode_id='15800000-0000-4158-8158-000000000402')<>0
 OR (SELECT count(*) FROM public.marcosa_season_bookmarks WHERE episode_id='15800000-0000-4158-8158-000000000402')<>0
 THEN RAISE EXCEPTION 'R158 restored erased consent'; END IF;
 IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid='marcosa_private.r158_sessions'::regclass)
 THEN RAISE EXCEPTION 'R158 private session RLS disabled'; END IF;
END $$;
SET ROLE anon;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_seasons WHERE slug='r158-test-season')
 THEN RAISE EXCEPTION 'R158 archived season readable by anon'; END IF;
 BEGIN
  PERFORM count(*) FROM marcosa_private.r158_sessions;
  RAISE EXCEPTION 'R158 private sessions exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','15800000-0000-4158-8158-000000000002',false);
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_seasons WHERE slug='r158-test-season')
 OR (SELECT count(*) FROM public.marcosa_season_audit WHERE series_id='15800000-0000-4158-8158-000000000301')<>0
 THEN RAISE EXCEPTION 'R158 archived season or history leaked to reader'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','15800000-0000-4158-8158-000000000001',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_seasons WHERE slug='r158-test-season')<>1
 THEN RAISE EXCEPTION 'R158 owner lost archive'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
SELECT 'R158_POSTGRES_RESTORE_PRIVATE_SESSIONS_AND_RLS_PASS' AS proof;
