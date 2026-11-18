-- R155 disposable PostgreSQL 17 restore audit. Reject unknown databases.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF current_database()<>'marcosa_r155_restored'
 THEN RAISE EXCEPTION 'R155 restore proof refused on unexpected database'; END IF;
 IF (SELECT count(*) FROM public.marcosa_seasons WHERE slug LIKE 'r155-sample-%')<>2
 THEN RAISE EXCEPTION 'R155 restored season count mismatch'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_episodes e
  JOIN public.marcosa_seasons s ON s.id=e.series_id WHERE s.slug LIKE 'r155-sample-%')<>2
 THEN RAISE EXCEPTION 'R155 restored episode count mismatch'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_subscriptions sub
  JOIN public.marcosa_seasons s ON s.id=sub.series_id
  WHERE s.slug='r155-sample-open' AND sub.muted=true)<>1
 THEN RAISE EXCEPTION 'R155 reader preference not restored'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_audit a
  JOIN public.marcosa_seasons s ON s.id=a.series_id
  WHERE s.slug LIKE 'r155-sample-%')<4
 THEN RAISE EXCEPTION 'R155 editorial journal not restored'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.marcosa_posts
  WHERE body='It''s a 100% synthetic rehearsal: Initial open chapter')
 THEN RAISE EXCEPTION 'R155 publication body changed'; END IF;
 IF NOT(SELECT relrowsecurity FROM pg_class
  WHERE oid='public.marcosa_season_episodes'::regclass)
 THEN RAISE EXCEPTION 'R155 restored episode RLS disabled'; END IF;
END $$;
SET ROLE anon;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_seasons WHERE slug LIKE 'r155-sample-%')<>1
 THEN RAISE EXCEPTION 'R155 guest sees archived fixture'; END IF;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','15550000-0000-4555-8555-000000000002',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_seasons WHERE slug LIKE 'r155-sample-%')<>1
 THEN RAISE EXCEPTION 'R155 reader sees archive'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_subscriptions WHERE user_id=
  '15550000-0000-4555-8555-000000000002')<>1
 OR (SELECT count(*) FROM public.marcosa_season_bookmarks)<>1
 OR (SELECT count(*) FROM public.marcosa_season_attendance)<>1
 THEN RAISE EXCEPTION 'R155 private reader state not restored'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_audit)<>0
 THEN RAISE EXCEPTION 'R155 reader saw owner journal'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','15550000-0000-4555-8555-000000000001',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_seasons WHERE slug LIKE 'r155-sample-%')<>2
 THEN RAISE EXCEPTION 'R155 owner cannot see archived story'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_audit)<4
 THEN RAISE EXCEPTION 'R155 owner journal inaccessible'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
SELECT 'R155 restored PG17 synthetic tenant/RLS pass; production NO_GO' AS proof;
