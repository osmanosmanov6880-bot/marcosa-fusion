-- Synthetic Supabase auth.sessions shape. Test-only; never deploy as migration.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database()<>'postgres' THEN RAISE EXCEPTION 'R159 Auth fixture refuses live database'; END IF;
END $$;
CREATE TABLE auth.sessions(
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;
INSERT INTO auth.users(id) VALUES
 ('15900000-0000-4159-8159-000000000001'),
 ('15900000-0000-4159-8159-000000000002'),
 ('15900000-0000-4159-8159-000000000003');
INSERT INTO auth.sessions(id,user_id) VALUES
 ('15900000-0000-4159-8159-000000000501','15900000-0000-4159-8159-000000000001'),
 ('15900000-0000-4159-8159-000000000502','15900000-0000-4159-8159-000000000002');
INSERT INTO public.marcosa_profiles(id,handle,display_name) VALUES
 ('15900000-0000-4159-8159-000000000001','r159writer','R159 synthetic writer'),
 ('15900000-0000-4159-8159-000000000002','r159reader','R159 synthetic reader'),
 ('15900000-0000-4159-8159-000000000003','r159other','R159 synthetic other');
INSERT INTO public.marcosa_worlds(id,owner_id,slug,title,visibility) VALUES
 ('15900000-0000-4159-8159-000000000101','15900000-0000-4159-8159-000000000001','r159-lab-world','R159 disposable world','public');
INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status) VALUES
 ('15900000-0000-4159-8159-000000000201',
  '15900000-0000-4159-8159-000000000101','15900000-0000-4159-8159-000000000001',
  'R159 synthetic published episode','published');
INSERT INTO public.marcosa_seasons(id,world_id,owner_id,slug,title) VALUES
 ('15900000-0000-4159-8159-000000000301',
  '15900000-0000-4159-8159-000000000101','15900000-0000-4159-8159-000000000001',
  'r159-disposable','R159 synthetic season');
INSERT INTO public.marcosa_season_episodes(id,series_id,post_id,position,title) VALUES
 ('15900000-0000-4159-8159-000000000401','15900000-0000-4159-8159-000000000301',
  '15900000-0000-4159-8159-000000000201',1,'R159 initial');
INSERT INTO public.marcosa_season_subscriptions(series_id,user_id,muted) VALUES
 ('15900000-0000-4159-8159-000000000301','15900000-0000-4159-8159-000000000002',false),
 ('15900000-0000-4159-8159-000000000301','15900000-0000-4159-8159-000000000003',true);
INSERT INTO marcosa_private.r156_outbox(series_id,episode_id,user_id) VALUES
 ('15900000-0000-4159-8159-000000000301','15900000-0000-4159-8159-000000000401',
  '15900000-0000-4159-8159-000000000002'),
 ('15900000-0000-4159-8159-000000000301','15900000-0000-4159-8159-000000000401',
  '15900000-0000-4159-8159-000000000003');
SELECT 'R159 disposable PostgreSQL synthetic Auth and outbox seeded' AS proof;
