-- MARCOSA R128: evaluate ONLY a newly restored, disposable PostgreSQL 17 DB.
-- Ownership/anon/other-user policy checks use fixed canary fixtures, not old
-- R30-R84 identities deleted intentionally by earlier cascade-cleanup tests.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF current_database()<>'marcosa_r128_restored'
 THEN RAISE EXCEPTION 'R128 refuses verification on any other database'; END IF;
 IF (SELECT count(*) FROM auth.users WHERE id IN
   ('12800000-0000-4128-8128-000000000001',
    '12800000-0000-4128-8128-000000000002'))<>2
 THEN RAISE EXCEPTION 'R128 lost seeded Auth users during restore'; END IF;
 IF (SELECT count(*) FROM public.marcosa_profiles WHERE id IN
   ('12800000-0000-4128-8128-000000000001',
    '12800000-0000-4128-8128-000000000002'))<>2
 THEN RAISE EXCEPTION 'R128 lost seeded profiles during restore'; END IF;
 IF (SELECT count(*) FROM public.marcosa_worlds
   WHERE slug IN ('r128-private','r128-public'))<>2
 THEN RAISE EXCEPTION 'R128 lost seeded public/private Worlds'; END IF;
 IF (SELECT count(*) FROM public.marcosa_posts WHERE id IN
   ('12800000-0000-4128-8128-000000000201',
    '12800000-0000-4128-8128-000000000202'))<>2
 THEN RAISE EXCEPTION 'R128 lost seeded private/public posts'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='marcosa_posts' AND c.relrowsecurity
 ) THEN RAISE EXCEPTION 'R128 posts table RLS disabled after restore'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_policies
   WHERE schemaname='public' AND tablename='marcosa_worlds'
 ) THEN RAISE EXCEPTION 'R128 world RLS policies lost during restore'; END IF;
 IF has_table_privilege('anon','marcosa_private.sponsor_proposals','SELECT')
 OR has_table_privilege('authenticated','marcosa_private.sponsor_proposals','SELECT')
 THEN RAISE EXCEPTION 'R128 sponsor ledger was exposed during restore'; END IF;
END $$;
SET ROLE anon;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.marcosa_worlds WHERE slug='r128-private')
 THEN RAISE EXCEPTION 'R128 restored anon can see private world'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.marcosa_worlds WHERE slug='r128-public')
 THEN RAISE EXCEPTION 'R128 restored anon cannot see public world'; END IF;
 IF EXISTS (SELECT 1 FROM public.marcosa_posts
   WHERE id='12800000-0000-4128-8128-000000000201')
 THEN RAISE EXCEPTION 'R128 restored anon can read private post'; END IF;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','12800000-0000-4128-8128-000000000002',false);
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.marcosa_worlds WHERE slug='r128-private')
 THEN RAISE EXCEPTION 'R128 restored Bob can see Alice private world'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.marcosa_worlds WHERE slug='r128-public')
 THEN RAISE EXCEPTION 'R128 restored Bob cannot read his own world'; END IF;
 IF EXISTS (SELECT 1 FROM public.marcosa_posts
   WHERE id='12800000-0000-4128-8128-000000000201')
 THEN RAISE EXCEPTION 'R128 restored Bob can read Alice private post'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','12800000-0000-4128-8128-000000000001',false);
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.marcosa_worlds WHERE slug='r128-private')
 THEN RAISE EXCEPTION 'R128 restored Alice cannot see her private world'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.marcosa_posts
   WHERE id='12800000-0000-4128-8128-000000000201')
 THEN RAISE EXCEPTION 'R128 restored Alice cannot see her private post'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
SELECT 'R128_PG17_DISPOSABLE_RESTORE_MULTI_USER_RLS=PASS' AS result;
