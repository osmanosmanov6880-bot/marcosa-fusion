-- R55: live PostgreSQL 17 disposable CI only; never touches Supabase Storage.
\set ON_ERROR_STOP on
INSERT INTO auth.users(id) VALUES
 ('11111111-2222-4333-8444-555555555555'),
 ('22222222-3333-4444-8555-666666666666'),
 ('33333333-4444-4555-8666-777777777777');

INSERT INTO public.marcosa_worlds(id,owner_id,slug,title)
 VALUES
 ('77777777-7777-4777-8777-777777777777',
  '11111111-2222-4333-8444-555555555555','cover-test-world-a','Original cover world'),
 ('88888888-8888-4888-8888-888888888888',
  '22222222-3333-4444-8555-666666666666','cover-test-world-b','Other author world');

INSERT INTO marcosa_private.world_cover_assets
 (world_id,uploaded_by,storage_key,sha256,width,height,byte_size,status)
VALUES
 ('77777777-7777-4777-8777-777777777777',
  '11111111-2222-4333-8444-555555555555',
  'world-covers/77777777-7777-4777-8777-777777777777/'||repeat('a',64)||'.png',
  repeat('a',64),800,1000,100234,'pending');

DO $$
BEGIN
 IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid='marcosa_private.world_cover_assets'::regclass)
 THEN RAISE EXCEPTION 'R55: missing RLS'; END IF;
 IF has_schema_privilege('anon','marcosa_private','USAGE')
 OR has_schema_privilege('authenticated','marcosa_private','USAGE')
 THEN RAISE EXCEPTION 'R55: private media schema exposed'; END IF;
 IF has_table_privilege('anon','marcosa_private.world_cover_assets','SELECT')
 OR has_table_privilege('authenticated','marcosa_private.world_cover_assets','SELECT')
 OR has_table_privilege('authenticated','marcosa_private.world_cover_assets','INSERT')
 OR has_table_privilege('authenticated','marcosa_private.world_cover_assets','UPDATE')
 OR has_table_privilege('authenticated','marcosa_private.world_cover_assets','DELETE')
 THEN RAISE EXCEPTION 'R55: client can access unmoderated media assets'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='marcosa_private'
   AND tablename='world_cover_assets')<>0
 THEN RAISE EXCEPTION 'R55: unexpected public media policy'; END IF;
 IF (SELECT count(*) FROM marcosa_private.world_cover_assets
     WHERE status='pending' AND normalized=false)<>1
 THEN RAISE EXCEPTION 'R55: pending media row lost'; END IF;
END $$;

SET ROLE anon;
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.world_cover_assets;
  RAISE EXCEPTION 'R55: guest saw private media metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-2222-4333-8444-555555555555',false);
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.world_cover_assets;
  RAISE EXCEPTION 'R55: author read private unapproved files';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE marcosa_private.world_cover_assets SET status='approved'
  WHERE world_id='77777777-7777-4777-8777-777777777777';
  RAISE EXCEPTION 'R55: author bypassed quarantine';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

-- Trusted reviewer is independent of uploader and manifest was normalized.
UPDATE marcosa_private.world_cover_assets
 SET normalized=true,status='approved',
  reviewed_by='33333333-4444-4555-8666-777777777777',
  reviewed_at=now()
 WHERE world_id='77777777-7777-4777-8777-777777777777';

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM marcosa_private.world_cover_assets
 WHERE world_id='77777777-7777-4777-8777-777777777777'
 AND normalized AND status='approved'
 AND reviewed_by<>'11111111-2222-4333-8444-555555555555')
 THEN RAISE EXCEPTION 'R55: independent moderation not recorded'; END IF;
END $$;

DO $$
BEGIN
 BEGIN
  UPDATE marcosa_private.world_cover_assets
  SET reviewed_by='11111111-2222-4333-8444-555555555555'
  WHERE world_id='77777777-7777-4777-8777-777777777777';
  RAISE EXCEPTION 'R55: self-review accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  UPDATE marcosa_private.world_cover_assets SET normalized=false
  WHERE world_id='77777777-7777-4777-8777-777777777777';
  RAISE EXCEPTION 'R55: unnormalized image approved';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO marcosa_private.world_cover_assets
   (world_id,uploaded_by,storage_key,sha256,width,height,byte_size)
  VALUES('88888888-8888-4888-8888-888888888888',
   '11111111-2222-4333-8444-555555555555',
   'world-covers/88888888-8888-4888-8888-888888888888/'||repeat('b',64)||'.png',
   repeat('b',64),100,200,4000);
  RAISE EXCEPTION 'R55: wrong uploader inserted media for another World';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'R55:%' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO marcosa_private.world_cover_assets
   (world_id,uploaded_by,storage_key,sha256,width,height,byte_size)
  VALUES('88888888-8888-4888-8888-888888888888',
   '22222222-3333-4444-8555-666666666666',
   'world-covers/88888888-8888-4888-8888-888888888888/'||repeat('c',64)||'.png',
   repeat('b',64),100,200,4000);
  RAISE EXCEPTION 'R55: checksum storage path mismatch accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'R55:%' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO marcosa_private.world_cover_assets
   (world_id,uploaded_by,storage_key,sha256,width,height,byte_size)
  VALUES('88888888-8888-4888-8888-888888888888',
   '22222222-3333-4444-8555-666666666666',
   'world-covers/88888888-8888-4888-8888-888888888888/'||repeat('b',64)||'.png',
   repeat('b',64),1600,1600,4000);
  RAISE EXCEPTION 'R55: decompression-bomb dimensions accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF (SELECT count(*) FROM marcosa_private.world_cover_assets)<>1
 THEN RAISE EXCEPTION 'R55: invalid rows persisted'; END IF;
END $$;

DELETE FROM public.marcosa_worlds
 WHERE id='77777777-7777-4777-8777-777777777777';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_assets)
 THEN RAISE EXCEPTION 'R55: World deletion did not cascade manifest'; END IF;
END $$;
SELECT 'MARCOSA R55 private cover manifest PostgreSQL ACL and lifecycle PASS' AS proof;
