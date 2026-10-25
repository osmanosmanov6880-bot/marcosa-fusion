-- R58: disposable PostgreSQL contract for owner-only private image appeals.
\set ON_ERROR_STOP on
-- R55 left B's World and three independently simulated auth.users.
INSERT INTO marcosa_private.world_cover_assets
(world_id,uploaded_by,storage_key,sha256,width,height,byte_size,
 normalized,status,reviewed_by,reviewed_at)
VALUES
('88888888-8888-4888-8888-888888888888',
 '22222222-3333-4444-8555-666666666666',
 'world-covers/88888888-8888-4888-8888-888888888888/'||repeat('b',64)||'.png',
 repeat('b',64),1280,720,90000,
 true,'quarantined','33333333-4444-4555-8666-777777777777',now());
INSERT INTO marcosa_private.world_cover_appeals
(id,world_id,owner_id,asset_sha256,reason)
VALUES
('99999999-9999-4999-8999-999999999999',
 '88888888-8888-4888-8888-888888888888',
 '22222222-3333-4444-8555-666666666666',
 repeat('b',64),'This is my original artwork and I request independent review');

DO $$
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class
  WHERE oid='marcosa_private.world_cover_appeals'::regclass)
 THEN RAISE EXCEPTION 'R58: RLS missing'; END IF;
 IF has_schema_privilege('anon','marcosa_private','USAGE') OR
    has_schema_privilege('authenticated','marcosa_private','USAGE')
 THEN RAISE EXCEPTION 'R58: private schema exposed'; END IF;
 IF has_table_privilege('authenticated','marcosa_private.world_cover_appeals','SELECT')
 OR has_table_privilege('authenticated','marcosa_private.world_cover_appeals','UPDATE')
 OR has_table_privilege('authenticated','marcosa_private.world_cover_appeals','INSERT')
 OR has_table_privilege('authenticated','marcosa_private.world_cover_appeals','DELETE')
 OR has_table_privilege('anon','marcosa_private.world_cover_appeals','SELECT')
 THEN RAISE EXCEPTION 'R58: browser can access appeals'; END IF;
 IF (SELECT count(*) FROM pg_policies
 WHERE schemaname='marcosa_private' AND tablename='world_cover_appeals')<>0
 THEN RAISE EXCEPTION 'R58: unexpected public appeal policy'; END IF;
 IF (SELECT original_reviewer FROM marcosa_private.world_cover_appeals
 WHERE id='99999999-9999-4999-8999-999999999999')
 <>'33333333-4444-4555-8666-777777777777'::uuid
 THEN RAISE EXCEPTION 'R58: rejecting reviewer provenance was not captured by database'; END IF;
END $$;

SET ROLE anon;
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.world_cover_appeals;
  RAISE EXCEPTION 'R58: guest could inspect private appeal';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-3333-4444-8555-666666666666',false);
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.world_cover_appeals;
  RAISE EXCEPTION 'R58: author could inspect private appeal ledger';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE marcosa_private.world_cover_appeals SET status='reopened',
   reviewed_by='11111111-2222-4333-8444-555555555555',decided_at=now();
  RAISE EXCEPTION 'R58: owner self-authorized appeal through Data API';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

DO $$
BEGIN
 BEGIN
  INSERT INTO marcosa_private.world_cover_appeals(world_id,owner_id,asset_sha256,reason)
  VALUES ('88888888-8888-4888-8888-888888888888',
   '22222222-3333-4444-8555-666666666666',repeat('b',64),
   'Another duplicate review of my art');
  RAISE EXCEPTION 'R58: duplicate open appeal accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO marcosa_private.world_cover_appeals(world_id,owner_id,asset_sha256,reason)
  VALUES ('88888888-8888-4888-8888-888888888888',
   '11111111-2222-4333-8444-555555555555',repeat('b',64),
   'I wrongly claim this foreign World asset');
  RAISE EXCEPTION 'R58: foreign ownership accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'R58:%' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO marcosa_private.world_cover_appeals(world_id,owner_id,asset_sha256,reason)
  VALUES ('88888888-8888-4888-8888-888888888888',
   '22222222-3333-4444-8555-666666666666',repeat('c',64),
   'I wrongly reference a stale image');
  RAISE EXCEPTION 'R58: stale image digest accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'R58:%' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE marcosa_private.world_cover_appeals SET status='reopened',
   reviewed_by='33333333-4444-4555-8666-777777777777',decided_at=now()
  WHERE id='99999999-9999-4999-8999-999999999999';
  RAISE EXCEPTION 'R58: same rejecting reviewer accepted appeal';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  UPDATE marcosa_private.world_cover_appeals SET status='reopened',
   reviewed_by='22222222-3333-4444-8555-666666666666',decided_at=now()
  WHERE id='99999999-9999-4999-8999-999999999999';
  RAISE EXCEPTION 'R58: cover owner self-reviewed appeal';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  UPDATE marcosa_private.world_cover_appeals SET reason='replace immutable record'
  WHERE id='99999999-9999-4999-8999-999999999999';
  RAISE EXCEPTION 'R58: appeal provenance rewritten';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'R58:%' THEN RAISE; END IF;
 END;
END $$;

-- Independent reviewer A reopens appeal, but media must stay quarantined
-- until a separate, verified trusted moderation action.
UPDATE marcosa_private.world_cover_appeals
 SET status='reopened', reviewed_by='11111111-2222-4333-8444-555555555555',
 decided_at=now()
 WHERE id='99999999-9999-4999-8999-999999999999';
DO $$
BEGIN
 IF (SELECT status FROM marcosa_private.world_cover_appeals
 WHERE id='99999999-9999-4999-8999-999999999999')<>'reopened'
 THEN RAISE EXCEPTION 'R58: independent decision not saved'; END IF;
 IF (SELECT status FROM marcosa_private.world_cover_assets
 WHERE world_id='88888888-8888-4888-8888-888888888888')<>'quarantined'
 THEN RAISE EXCEPTION 'R58: appeal silently published quarantined media'; END IF;
 BEGIN
  UPDATE marcosa_private.world_cover_appeals SET status='upheld'
  WHERE id='99999999-9999-4999-8999-999999999999';
  RAISE EXCEPTION 'R58: reopened appeal overwritten';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'R58:%' THEN RAISE; END IF;
 END;
END $$;

DELETE FROM public.marcosa_worlds
 WHERE id='88888888-8888-4888-8888-888888888888';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_appeals)
 THEN RAISE EXCEPTION 'R58: World deletion left appeal data'; END IF;
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_assets)
 THEN RAISE EXCEPTION 'R58: World deletion left private media'; END IF;
END $$;
SELECT 'MARCOSA R58 private independent media appeal contract PASS' AS proof;
