-- R155 disposable PostgreSQL 17, ONLY synthetic users and social content.
\set ON_ERROR_STOP on
INSERT INTO auth.users(id) VALUES
 ('15500000-0000-4155-8155-000000000001'),
 ('15500000-0000-4155-8155-000000000002'),
 ('15500000-0000-4155-8155-000000000003');
INSERT INTO public.marcosa_profiles(id,handle,display_name) VALUES
 ('15500000-0000-4155-8155-000000000001','alice155','R155 Alice'),
 ('15500000-0000-4155-8155-000000000002','bob155','R155 Bob'),
 ('15500000-0000-4155-8155-000000000003','carol155','R155 Carol');
INSERT INTO public.marcosa_worlds(id,owner_id,slug,title,visibility) VALUES
 ('15500000-0000-4155-8155-000000000101','15500000-0000-4155-8155-000000000001','alice-155-public','Alice public world','public'),
 ('15500000-0000-4155-8155-000000000102','15500000-0000-4155-8155-000000000001','alice-155-private','Alice private world','private'),
 ('15500000-0000-4155-8155-000000000103','15500000-0000-4155-8155-000000000002','bob-155-public','Bob public world','public');
INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status) VALUES
 ('15500000-0000-4155-8155-000000000201','15500000-0000-4155-8155-000000000101','15500000-0000-4155-8155-000000000001','Alice published chapter','published'),
 ('15500000-0000-4155-8155-000000000202','15500000-0000-4155-8155-000000000102','15500000-0000-4155-8155-000000000001','Alice PRIVATE chapter','published'),
 ('15500000-0000-4155-8155-000000000203','15500000-0000-4155-8155-000000000101','15500000-0000-4155-8155-000000000001','Alice archived chapter','published'),
 ('15500000-0000-4155-8155-000000000204','15500000-0000-4155-8155-000000000103','15500000-0000-4155-8155-000000000002','Bob published chapter','published'),
 ('15500000-0000-4155-8155-000000000205','15500000-0000-4155-8155-000000000101','15500000-0000-4155-8155-000000000001','Alice unpublished draft','draft');
INSERT INTO public.marcosa_seasons(id,world_id,owner_id,slug,title,archived_at) VALUES
 ('15500000-0000-4155-8155-000000000301','15500000-0000-4155-8155-000000000101','15500000-0000-4155-8155-000000000001','alice-r155-open','Alice public season',NULL),
 ('15500000-0000-4155-8155-000000000302','15500000-0000-4155-8155-000000000102','15500000-0000-4155-8155-000000000001','alice-r155-private','Alice private season',NULL),
 ('15500000-0000-4155-8155-000000000303','15500000-0000-4155-8155-000000000101','15500000-0000-4155-8155-000000000001','alice-r155-archive','Alice archived season',now()),
 ('15500000-0000-4155-8155-000000000304','15500000-0000-4155-8155-000000000103','15500000-0000-4155-8155-000000000002','bob-r155-open','Bob public season',NULL);
INSERT INTO public.marcosa_season_episodes(id,series_id,post_id,position,title) VALUES
 ('15500000-0000-4155-8155-000000000401','15500000-0000-4155-8155-000000000301','15500000-0000-4155-8155-000000000201',1,'Alice first'),
 ('15500000-0000-4155-8155-000000000402','15500000-0000-4155-8155-000000000302','15500000-0000-4155-8155-000000000202',1,'Alice private'),
 ('15500000-0000-4155-8155-000000000403','15500000-0000-4155-8155-000000000303','15500000-0000-4155-8155-000000000203',1,'Alice archived'),
 ('15500000-0000-4155-8155-000000000404','15500000-0000-4155-8155-000000000304','15500000-0000-4155-8155-000000000204',1,'Bob first');
INSERT INTO public.marcosa_season_subscriptions(series_id,user_id,muted) VALUES
 ('15500000-0000-4155-8155-000000000301','15500000-0000-4155-8155-000000000002',true),
 ('15500000-0000-4155-8155-000000000301','15500000-0000-4155-8155-000000000003',false);
INSERT INTO public.marcosa_season_bookmarks(episode_id,user_id) VALUES
 ('15500000-0000-4155-8155-000000000401','15500000-0000-4155-8155-000000000002'),
 ('15500000-0000-4155-8155-000000000404','15500000-0000-4155-8155-000000000003');
INSERT INTO public.marcosa_season_attendance(episode_id,viewer_id) VALUES
 ('15500000-0000-4155-8155-000000000401','15500000-0000-4155-8155-000000000002');
INSERT INTO public.marcosa_season_audit(id,series_id,actor_id,action,details) VALUES
 ('15500000-0000-4155-8155-000000000501','15500000-0000-4155-8155-000000000301','15500000-0000-4155-8155-000000000001','series_created','{"title":"Alice public season"}'),
 ('15500000-0000-4155-8155-000000000502','15500000-0000-4155-8155-000000000304','15500000-0000-4155-8155-000000000002','series_created','{"title":"Bob public season"}');

-- Real RLS must be ON for all six tables; grants and policies are distinct.
DO $$ DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY[
  'marcosa_seasons','marcosa_season_episodes','marcosa_season_subscriptions',
  'marcosa_season_bookmarks','marcosa_season_attendance','marcosa_season_audit']
 LOOP
  IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||name)::regclass)
  THEN RAISE EXCEPTION 'R155 RLS missing: %',name; END IF;
  IF has_table_privilege('authenticated','public.'||name,'INSERT')
   OR has_table_privilege('authenticated','public.'||name,'UPDATE')
   OR has_table_privilege('authenticated','public.'||name,'DELETE')
  THEN RAISE EXCEPTION 'R155 unexpected Data API write grant: %',name; END IF;
 END LOOP;
 IF has_table_privilege('anon','public.marcosa_season_bookmarks','SELECT')
  OR has_table_privilege('anon','public.marcosa_season_audit','SELECT')
  OR has_table_privilege('anon','public.marcosa_season_subscriptions','SELECT')
 THEN RAISE EXCEPTION 'R155 private reader roster exposed to anon'; END IF;
 IF has_function_privilege('authenticated','marcosa_private.r155_season_owner_guard()','EXECUTE')
  OR has_function_privilege('anon','marcosa_private.r155_episode_post_guard()','EXECUTE')
 THEN RAISE EXCEPTION 'R155 private guard functions exposed'; END IF;
END $$;

SET ROLE anon;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_seasons)<>2
 THEN RAISE EXCEPTION 'R155 guest sees private or archived season'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_episodes)<>2
 THEN RAISE EXCEPTION 'R155 guest sees private or archived episode'; END IF;
 BEGIN
  PERFORM count(*) FROM public.marcosa_season_bookmarks;
  RAISE EXCEPTION 'R155 anonymous bookmark list exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','15500000-0000-4155-8155-000000000002',false);
DO $$
DECLARE n integer;
BEGIN
 IF (SELECT count(*) FROM public.marcosa_seasons)<>2
 THEN RAISE EXCEPTION 'R155 Bob sees Alice private/archived content'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_episodes)<>2
 THEN RAISE EXCEPTION 'R155 Bob sees Alice private/archived episodes'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_subscriptions)<>1
  OR (SELECT count(*) FROM public.marcosa_season_bookmarks)<>1
  OR (SELECT count(*) FROM public.marcosa_season_attendance)<>1
  OR (SELECT count(*) FROM public.marcosa_season_audit)<>1
 THEN RAISE EXCEPTION 'R155 Bob can inspect another reader or author history'; END IF;
 BEGIN
  INSERT INTO public.marcosa_season_bookmarks(episode_id,user_id) VALUES
    ('15500000-0000-4155-8155-000000000404','15500000-0000-4155-8155-000000000002');
  RAISE EXCEPTION 'R155 browser write unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE public.marcosa_seasons SET owner_id='15500000-0000-4155-8155-000000000002'
  WHERE id='15500000-0000-4155-8155-000000000301';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'R155 Bob stole Alice season'; END IF;
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','15500000-0000-4155-8155-000000000001',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_seasons)<>4
 THEN RAISE EXCEPTION 'R155 Alice cannot see her private/archived seasons'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_episodes)<>4
 THEN RAISE EXCEPTION 'R155 Alice cannot read her own archived episodes'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_audit)<>1
 THEN RAISE EXCEPTION 'R155 Alice can read Bob editorial audit'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_subscriptions)<>0
 THEN RAISE EXCEPTION 'R155 Alice can read Bob/Carol subscription rosters'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','15500000-0000-4155-8155-000000000003',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_season_subscriptions)<>1
 OR (SELECT count(*) FROM public.marcosa_season_bookmarks)<>1
 OR (SELECT count(*) FROM public.marcosa_season_attendance)<>0
 THEN RAISE EXCEPTION 'R155 Carol sees other users data'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

-- Trusted input guards still reject cross-tenant and unpublished attachments.
DO $$
BEGIN
 BEGIN
  INSERT INTO public.marcosa_seasons(id,world_id,owner_id,slug,title)
   VALUES('15500000-0000-4155-8155-000000000390','15500000-0000-4155-8155-000000000101',
   '15500000-0000-4155-8155-000000000002','forged-r155-owner','Forgery');
  RAISE EXCEPTION 'R155 forged season owner was inserted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO public.marcosa_season_episodes(id,series_id,post_id,position,title)
   VALUES('15500000-0000-4155-8155-000000000490','15500000-0000-4155-8155-000000000301',
   '15500000-0000-4155-8155-000000000204',2,'Cross-tenant post');
  RAISE EXCEPTION 'R155 foreign post added to Alice season';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO public.marcosa_season_episodes(id,series_id,post_id,position,title)
   VALUES('15500000-0000-4155-8155-000000000491','15500000-0000-4155-8155-000000000301',
   '15500000-0000-4155-8155-000000000205',2,'Draft post');
  RAISE EXCEPTION 'R155 draft post became public episode';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;

-- A reciprocal block immediately revokes visibility for the blocked reader;
-- existing bookmark UUID may remain for account deletion/retention policy,
-- but is hidden by the bookmark SELECT policy.
INSERT INTO public.marcosa_user_blocks(blocker_id,blocked_id)
VALUES('15500000-0000-4155-8155-000000000001','15500000-0000-4155-8155-000000000002');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','15500000-0000-4155-8155-000000000002',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_seasons)<>1
  OR (SELECT count(*) FROM public.marcosa_season_episodes)<>1
  OR (SELECT count(*) FROM public.marcosa_season_bookmarks)<>0
 THEN RAISE EXCEPTION 'R155 reciprocal private block leaked a creator/episode/bookmark'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

-- FK chain: deleting a post clears episode, bookmark, and attendance but not
-- other tenants' seasons. This is a test-only destructive action.
DELETE FROM public.marcosa_posts WHERE id='15500000-0000-4155-8155-000000000201';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_season_episodes WHERE id='15500000-0000-4155-8155-000000000401')
  OR EXISTS(SELECT 1 FROM public.marcosa_season_bookmarks WHERE episode_id='15500000-0000-4155-8155-000000000401')
  OR EXISTS(SELECT 1 FROM public.marcosa_season_attendance WHERE episode_id='15500000-0000-4155-8155-000000000401')
 THEN RAISE EXCEPTION 'R155 FK deletion did not cascade'; END IF;
 IF (SELECT count(*) FROM public.marcosa_seasons)<>4
 THEN RAISE EXCEPTION 'R155 cascade erased another tenant season'; END IF;
END $$;
SELECT 'R155 PG17 owner/guest/private-bookmarks/archival/block/guard/cascade isolation PASS' AS proof;
