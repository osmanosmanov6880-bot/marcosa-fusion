-- R129: ONLY the restored disposable PostgreSQL 17 fixture.
-- Real Supabase auth/storage projects, users and bytes are never accessed.
\set ON_ERROR_STOP on
DO $$
DECLARE private_world uuid:='12800000-0000-4128-8128-000000000101';
DECLARE public_world uuid:='12800000-0000-4128-8128-000000000102';
BEGIN
 IF current_database()<>'marcosa_r128_restored'
 THEN RAISE EXCEPTION 'R129 refuses any non-disposable restored database'; END IF;
 IF (SELECT count(*) FROM marcosa_private.world_cover_assets
     WHERE world_id IN (private_world,public_world))<>2
 THEN RAISE EXCEPTION 'R129 restored PostgreSQL media rows missing'; END IF;
 IF NOT EXISTS(
    SELECT 1 FROM marcosa_private.world_cover_assets a
    JOIN public.marcosa_worlds w ON w.id=a.world_id
    WHERE a.world_id=private_world AND a.uploaded_by=w.owner_id
      AND w.visibility='private' AND a.status='pending'
      AND a.normalized=false AND a.reviewed_by IS NULL)
 THEN RAISE EXCEPTION 'R129 private owner/media moderation not preserved'; END IF;
 IF NOT EXISTS(
    SELECT 1 FROM marcosa_private.world_cover_assets a
    JOIN public.marcosa_worlds w ON w.id=a.world_id
    WHERE a.world_id=public_world AND a.uploaded_by=w.owner_id
      AND w.visibility='public' AND a.status='approved'
      AND a.normalized AND a.reviewed_at IS NOT NULL
      AND a.reviewed_by='12800000-0000-4128-8128-000000000003'
      AND a.reviewed_by<>a.uploaded_by)
 THEN RAISE EXCEPTION 'R129 independent reviewer status lost after restore'; END IF;
 IF NOT(SELECT relrowsecurity FROM pg_class
        WHERE oid='marcosa_private.world_cover_assets'::regclass)
 THEN RAISE EXCEPTION 'R129 private asset RLS missing after restore'; END IF;
 IF has_schema_privilege('anon','marcosa_private','USAGE')
 OR has_schema_privilege('authenticated','marcosa_private','USAGE')
 OR has_table_privilege('anon','marcosa_private.world_cover_assets','SELECT')
 OR has_table_privilege('authenticated','marcosa_private.world_cover_assets','SELECT')
 THEN RAISE EXCEPTION 'R129 restored media metadata exposed to browser role'; END IF;
END $$;
SET ROLE anon;
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.world_cover_assets;
  RAISE EXCEPTION 'R129 anonymous client saw restored storage keys';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',
 '12800000-0000-4128-8128-000000000001',false);
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.world_cover_assets;
  RAISE EXCEPTION 'R129 Alice bypassed private metadata ACL';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE marcosa_private.world_cover_assets SET status='approved'
  WHERE world_id='12800000-0000-4128-8128-000000000101';
  RAISE EXCEPTION 'R129 owner bypassed media moderation';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
SELECT 'R129_RESTORED_DISPOSABLE_PG17_STORAGE_ACL=PASS' AS result;
