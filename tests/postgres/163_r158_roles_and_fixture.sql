-- R158: disposable, synthetic PostgreSQL 17 Auth/session/creator fixtures.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF current_database()<>'postgres' THEN RAISE EXCEPTION 'R158 must be disposable'; END IF;
END $$;
CREATE ROLE marcosa_r158_ci LOGIN NOINHERIT NOBYPASSRLS PASSWORD 'r158-ci-gateway-only';
GRANT marcosa_r156_writer TO marcosa_r158_ci WITH INHERIT FALSE;
GRANT marcosa_r158_session_reader TO marcosa_r158_ci WITH INHERIT FALSE;
DO $$
BEGIN
 IF (SELECT rolsuper OR rolbypassrls OR rolinherit FROM pg_roles
  WHERE rolname='marcosa_r158_ci')
 THEN RAISE EXCEPTION 'R158 CI service has excessive privilege'; END IF;
 IF has_table_privilege('marcosa_r158_ci','marcosa_private.r158_sessions','SELECT')
 THEN RAISE EXCEPTION 'R158 login inherits private session read without role switch'; END IF;
 IF pg_has_role('authenticated','marcosa_r158_session_reader','MEMBER')
  OR pg_has_role('anon','marcosa_r156_writer','MEMBER')
 THEN RAISE EXCEPTION 'R158 browser inherited private roles'; END IF;
END $$;
INSERT INTO auth.users(id) VALUES
 ('15800000-0000-4158-8158-000000000001'),
 ('15800000-0000-4158-8158-000000000002'),
 ('15800000-0000-4158-8158-000000000003');
INSERT INTO public.marcosa_profiles(id,handle,display_name) VALUES
 ('15800000-0000-4158-8158-000000000001','r158owner','R158 Owner'),
 ('15800000-0000-4158-8158-000000000002','r158reader','R158 Reader'),
 ('15800000-0000-4158-8158-000000000003','r158stranger','R158 Stranger');
INSERT INTO public.marcosa_worlds(id,owner_id,slug,title,visibility) VALUES
 ('15800000-0000-4158-8158-000000000101','15800000-0000-4158-8158-000000000001','r158-test-world','R158 synthetic creator world','public');
INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status) VALUES
 ('15800000-0000-4158-8158-000000000201','15800000-0000-4158-8158-000000000101','15800000-0000-4158-8158-000000000001','R158 first published','published'),
 ('15800000-0000-4158-8158-000000000202','15800000-0000-4158-8158-000000000101','15800000-0000-4158-8158-000000000001','R158 second published','published'),
 ('15800000-0000-4158-8158-000000000203','15800000-0000-4158-8158-000000000101','15800000-0000-4158-8158-000000000001','R158 planned published','published');
INSERT INTO public.marcosa_seasons(id,world_id,owner_id,slug,title,description) VALUES
 ('15800000-0000-4158-8158-000000000301',
  '15800000-0000-4158-8158-000000000101','15800000-0000-4158-8158-000000000001',
  'r158-test-season','R158 Initial Season','Disposable PG test');
INSERT INTO public.marcosa_season_episodes(id,series_id,post_id,position,title) VALUES
 ('15800000-0000-4158-8158-000000000401','15800000-0000-4158-8158-000000000301',
  '15800000-0000-4158-8158-000000000201',1,'R158 First');
INSERT INTO marcosa_private.r158_sessions(session_id,user_id,expires_at) VALUES
 ('15800000-0000-4158-8158-000000000501','15800000-0000-4158-8158-000000000001',now()+interval '1 day'),
 ('15800000-0000-4158-8158-000000000502','15800000-0000-4158-8158-000000000002',now()+interval '1 day'),
 ('15800000-0000-4158-8158-000000000503','15800000-0000-4158-8158-000000000003',now()+interval '1 day');
SET ROLE authenticated;
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.r158_sessions;
  RAISE EXCEPTION 'R158 browser could read private sessions';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM count(*) FROM marcosa_private.r156_commands;
  RAISE EXCEPTION 'R158 browser could read command log';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET ROLE marcosa_r158_ci;
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.r158_sessions;
  RAISE EXCEPTION 'R158 login accessed private sessions without role switch';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM marcosa_private.r156_edit_series(
   '15800000-0000-4158-8158-000000000001',
   '15800000-0000-4158-8158-000000000301',0,'Forbidden direct','',
   '15800000-0000-4158-8158-000000000909');
  RAISE EXCEPTION 'R158 login wrote directly without role switch';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SELECT 'R158 synthetic roles, credentials, privacy and session fixture PASS' AS proof;
