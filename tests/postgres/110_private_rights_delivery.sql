-- R75 disposable PostgreSQL 17, no live Supabase project.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid='marcosa_private.world_cover_rights_claims'::regclass)
 THEN RAISE EXCEPTION 'R75: missing private rights RLS'; END IF;
 IF has_table_privilege('authenticated','marcosa_private.world_cover_rights_claims','INSERT')
 OR has_table_privilege('authenticated','marcosa_private.world_cover_rights_claims','SELECT')
 OR has_schema_privilege('anon','marcosa_private','USAGE')
 THEN RAISE EXCEPTION 'R75: private rights table exposed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='marcosa_private.world_cover_delivery_ready'::regclass
  AND 'security_invoker=true'=ANY(reloptions))
 THEN RAISE EXCEPTION 'R75: view is not security-invoker'; END IF;
END $$;
UPDATE auth.users SET raw_app_meta_data='{"marcosa_role":"moderator"}'::jsonb
 WHERE id='33333333-4444-4555-8666-777777777777';
INSERT INTO public.marcosa_worlds(id,owner_id,slug,title,visibility)
VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 '11111111-2222-4333-8444-555555555555','r75-claim-world','R75 private image','public');
INSERT INTO marcosa_private.world_cover_assets(
 world_id,uploaded_by,storage_key,sha256,mime,width,height,byte_size,
 normalized,status,reviewed_by,reviewed_at)
VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 '11111111-2222-4333-8444-555555555555',
 'world-covers/dddddddd-dddd-4ddd-8ddd-dddddddddddd/'||repeat('f',64)||'.png',
 repeat('f',64),'image/png',1280,720,123456,true,'approved',
 '33333333-4444-4555-8666-777777777777',now());
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_delivery_ready
 WHERE world_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')
 THEN RAISE EXCEPTION 'R75: old approved image lacks new rights declaration'; END IF;
END $$;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.world_cover_rights_claims;
  RAISE EXCEPTION 'R75: client read private rights table';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$
BEGIN
 BEGIN
  INSERT INTO marcosa_private.world_cover_rights_claims(world_id,owner_id,asset_sha256)
  VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   '22222222-3333-4444-8555-666666666666',repeat('f',64));
  RAISE EXCEPTION 'R75: mismatched owner unexpectedly inserted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'R75:%' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO marcosa_private.world_cover_rights_claims(world_id,owner_id,asset_sha256)
  VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   '11111111-2222-4333-8444-555555555555',repeat('0',64));
  RAISE EXCEPTION 'R75: incorrect digest unexpectedly inserted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'R75:%' THEN RAISE; END IF;
 END;
END $$;
INSERT INTO marcosa_private.world_cover_rights_claims(world_id,owner_id,asset_sha256)
VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 '11111111-2222-4333-8444-555555555555',repeat('f',64));
DO $$ BEGIN
 IF (SELECT count(*) FROM marcosa_private.world_cover_delivery_ready
  WHERE world_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')<>1
 THEN RAISE EXCEPTION 'R75: eligible current image unavailable'; END IF;
END $$;
UPDATE marcosa_private.world_cover_assets
 SET status='pending',sha256=repeat('0',64),
 storage_key='world-covers/dddddddd-dddd-4ddd-8ddd-dddddddddddd/'||repeat('0',64)||'.png',
 reviewed_by=NULL,reviewed_at=NULL
 WHERE world_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
UPDATE marcosa_private.world_cover_assets SET status='approved',
 reviewed_by='33333333-4444-4555-8666-777777777777',reviewed_at=now()
 WHERE world_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_delivery_ready
 WHERE world_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')
 THEN RAISE EXCEPTION 'R75: old digest claim allowed replaced image'; END IF;
END $$;
INSERT INTO marcosa_private.world_cover_rights_claims(world_id,owner_id,asset_sha256)
VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 '11111111-2222-4333-8444-555555555555',repeat('0',64));
DO $$ BEGIN
 IF (SELECT count(*) FROM marcosa_private.world_cover_delivery_ready
  WHERE world_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')<>1
 OR (SELECT count(*) FROM marcosa_private.world_cover_rights_claims
  WHERE world_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')<>2
 THEN RAISE EXCEPTION 'R75: current claim or historical proof invalid'; END IF;
END $$;
UPDATE auth.users SET raw_app_meta_data='{}'::jsonb
 WHERE id='33333333-4444-4555-8666-777777777777';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_delivery_ready
 WHERE world_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')
 THEN RAISE EXCEPTION 'R75: revoked reviewer allowed image'; END IF;
END $$;
DELETE FROM public.marcosa_worlds WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_rights_claims
 WHERE world_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')
 THEN RAISE EXCEPTION 'R75: deleted World retained rights history'; END IF;
END $$;
SELECT 'MARCOSA R75 private rights delivery gate PG17 PASS' AS proof;
