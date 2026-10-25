-- R72: REAL disposable PostgreSQL 17 integration proof.
-- Never runs against Supabase Storage or a connected production project.
\set ON_ERROR_STOP on

INSERT INTO auth.users(id,raw_app_meta_data,raw_user_meta_data) VALUES
 ('44444444-5555-4666-8777-888888888888','{}','{"marcosa_role":"moderator"}'),
 ('55555555-6666-4777-8888-999999999999','{}','{}'),
 ('66666666-7777-4888-8999-000000000000','{}','{}');
UPDATE auth.users SET raw_app_meta_data='{"marcosa_role":"moderator"}'::jsonb
 WHERE id='33333333-4444-4555-8666-777777777777';

INSERT INTO public.marcosa_worlds(id,owner_id,slug,title,visibility)
VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 '11111111-2222-4333-8444-555555555555','r72-report-world','R72 approved cover','public');
INSERT INTO marcosa_private.world_cover_assets(
 world_id,uploaded_by,storage_key,sha256,mime,width,height,byte_size,
 normalized,status,reviewed_by,reviewed_at
) VALUES(
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 '11111111-2222-4333-8444-555555555555',
 'world-covers/cccccccc-cccc-4ccc-8ccc-cccccccccccc/'||repeat('e',64)||'.png',
 repeat('e',64),'image/png',1200,600,101234,true,'approved',
 '33333333-4444-4555-8666-777777777777',now()
);

DO $$
BEGIN
 IF NOT(SELECT relrowsecurity FROM pg_class
  WHERE oid='marcosa_private.world_cover_reports'::regclass)
 THEN RAISE EXCEPTION 'R72: private report RLS missing'; END IF;
 IF has_schema_privilege('anon','marcosa_private','USAGE')
 OR has_schema_privilege('authenticated','marcosa_private','USAGE')
 OR has_table_privilege('anon','marcosa_private.world_cover_reports','SELECT')
 OR has_table_privilege('authenticated','marcosa_private.world_cover_reports','INSERT')
 OR has_table_privilege('authenticated','marcosa_private.world_cover_reports','UPDATE')
 THEN RAISE EXCEPTION 'R72: anonymous/client Data API exposed report history'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='marcosa_private'
      AND tablename='world_cover_reports')<>0
 THEN RAISE EXCEPTION 'R72: private report table has browser RLS policy'; END IF;
END $$;
SET ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.world_cover_reports;
  RAISE EXCEPTION 'R72TEST: anon read private report data';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-3333-4444-8555-666666666666',false);
DO $$ BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.world_cover_reports;
  RAISE EXCEPTION 'R72TEST: authenticated reporter bypassed queue';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO marcosa_private.world_cover_reports(
   world_id,reporter_id,asset_sha256,reason,detail)
  VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '22222222-3333-4444-8555-666666666666',repeat('e',64),
    'privacy','An unauthorized direct browser report');
  RAISE EXCEPTION 'R72TEST: browser wrote private queue';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

-- A separate trusted backend (postgres CI role, never browser JWT)
-- may insert a complaint only for the CURRENT approved, independent PNG.
INSERT INTO marcosa_private.world_cover_reports(
 world_id,reporter_id,asset_sha256,reason,detail)
VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 '22222222-3333-4444-8555-666666666666',repeat('e',64),
 'privacy','I believe this image reveals private personal information');
DO $$
BEGIN
 IF (SELECT count(*) FROM marcosa_private.world_cover_reports
  WHERE world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    AND status='open'
    AND original_reviewer='33333333-4444-4555-8666-777777777777')<>1
 THEN RAISE EXCEPTION 'R72: original independent reviewer not captured'; END IF;
 IF (SELECT count(*) FROM marcosa_private.world_cover_delivery_ready
     WHERE world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>1
 THEN RAISE EXCEPTION 'R72: report must not auto-hide a publicly approved PNG'; END IF;
END $$;

-- Owner, bad digest, blocked users, and pre-decided report cannot be inserted.
DO $$
BEGIN
 BEGIN
  INSERT INTO marcosa_private.world_cover_reports(world_id,reporter_id,asset_sha256,reason,detail)
  VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '11111111-2222-4333-8444-555555555555',repeat('e',64),'abuse',
    'The owner is trying to self-report this item');
  RAISE EXCEPTION 'R72TEST: owner self-report accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'R72:%' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO marcosa_private.world_cover_reports(world_id,reporter_id,asset_sha256,reason,detail)
  VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '55555555-6666-4777-8888-999999999999',repeat('f',64),'abuse',
    'A stale or spoofed content digest for this image');
  RAISE EXCEPTION 'R72TEST: wrong digest accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'R72:%' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO marcosa_private.world_cover_reports(
   world_id,reporter_id,asset_sha256,reason,detail,status,decided_by,decided_at)
  VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   '55555555-6666-4777-8888-999999999999',repeat('e',64),'privacy',
   'Prematurely approved complaint from a client','upheld',
   '44444444-5555-4666-8777-888888888888',now());
  RAISE EXCEPTION 'R72TEST: pre-decided report accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'R72:%' THEN RAISE; END IF;
 END;
END $$;

INSERT INTO public.marcosa_user_blocks(blocker_id,blocked_id)
VALUES('11111111-2222-4333-8444-555555555555',
       '55555555-6666-4777-8888-999999999999');
DO $$
BEGIN
 BEGIN
  INSERT INTO marcosa_private.world_cover_reports(
   world_id,reporter_id,asset_sha256,reason,detail)
  VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   '55555555-6666-4777-8888-999999999999',repeat('e',64),'privacy',
   'This blocked account cannot open the owner World');
  RAISE EXCEPTION 'R72TEST: blocked viewer submitted a report';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'R72:%' THEN RAISE; END IF;
 END;
END $$;
DELETE FROM public.marcosa_user_blocks
 WHERE blocker_id='11111111-2222-4333-8444-555555555555'
  AND blocked_id='55555555-6666-4777-8888-999999999999';

-- A second and third independent reporter produce two pending reports.
INSERT INTO marcosa_private.world_cover_reports(world_id,reporter_id,asset_sha256,reason,detail)
VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','55555555-6666-4777-8888-999999999999',
  repeat('e',64),'copyright','This exact cover appears to be copyrighted content'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','66666666-7777-4888-8999-000000000000',
  repeat('e',64),'other','Another reviewer should inspect this published photo');

-- A forged mod claim in user_metadata must NOT authorize a resolution.
DO $$
BEGIN
 BEGIN
  UPDATE marcosa_private.world_cover_reports
   SET status='upheld',decided_by='44444444-5555-4666-8777-888888888888',
       decided_at=now()
   WHERE reporter_id='22222222-3333-4444-8555-666666666666';
  RAISE EXCEPTION 'R72TEST: editable user metadata authorized takedown';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'R72:%' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE marcosa_private.world_cover_reports
   SET status='upheld',decided_by='33333333-4444-4555-8666-777777777777',
       decided_at=now()
   WHERE reporter_id='22222222-3333-4444-8555-666666666666';
  RAISE EXCEPTION 'R72TEST: original approving reviewer adjudicated their own media';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'R72:%' THEN RAISE; END IF;
 END;
END $$;

-- Trust only the server-managed app_metadata for a currently authorized moderator.
UPDATE auth.users SET raw_app_meta_data='{"marcosa_role":"moderator"}'::jsonb
 WHERE id='44444444-5555-4666-8777-888888888888';
UPDATE marcosa_private.world_cover_reports
 SET status='dismissed',decided_by='44444444-5555-4666-8777-888888888888',
     decided_at=now()
 WHERE reporter_id='22222222-3333-4444-8555-666666666666'
  AND world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
DO $$
BEGIN
 IF (SELECT count(*) FROM marcosa_private.world_cover_delivery_ready
     WHERE world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>1
 THEN RAISE EXCEPTION 'R72: dismissed report unexpectedly hid approved media'; END IF;
END $$;

-- Single confirmed report atomically quarantines the exact approved digest.
-- Other OPEN reports are withdrawn in the same database transaction.
UPDATE marcosa_private.world_cover_reports
 SET status='upheld',decided_by='44444444-5555-4666-8777-888888888888',
     decided_at=now()
 WHERE reporter_id='55555555-6666-4777-8888-999999999999'
  AND world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
DO $$
BEGIN
 IF (SELECT count(*) FROM marcosa_private.world_cover_reports
  WHERE world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     AND status='upheld')<>1
 THEN RAISE EXCEPTION 'R72: independent report decision not persisted'; END IF;
 IF (SELECT count(*) FROM marcosa_private.world_cover_reports
  WHERE world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     AND status='withdrawn')<>1
 THEN RAISE EXCEPTION 'R72: parallel open reports were not withdrawn'; END IF;
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_delivery_ready
   WHERE world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')
 THEN RAISE EXCEPTION 'R72: quarantined cover still has eligible private delivery key'; END IF;
 IF (SELECT status FROM marcosa_private.world_cover_assets
   WHERE world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>'quarantined'
 THEN RAISE EXCEPTION 'R72: cover still publicly approved after upheld report'; END IF;
END $$;

-- The trusted moderation-appeal contract is still compatible with a takedown.
INSERT INTO marcosa_private.world_cover_appeals(
 world_id,owner_id,asset_sha256,reason)
VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 '11111111-2222-4333-8444-555555555555',repeat('e',64),
 'Owner requests independent appeal on the removed published cover');
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM marcosa_private.world_cover_appeals
  WHERE world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    AND original_reviewer='44444444-5555-4666-8777-888888888888'
    AND status='open')
 THEN RAISE EXCEPTION 'R72: author appeal lost independent reviewer context'; END IF;
 BEGIN
  UPDATE marcosa_private.world_cover_reports
   SET status='dismissed',decided_by='44444444-5555-4666-8777-888888888888',
       decided_at=now()
   WHERE world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     AND reporter_id='55555555-6666-4777-8888-999999999999';
  RAISE EXCEPTION 'R72TEST: duplicate moderation decision accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'R72:%' THEN RAISE; END IF;
 END;
END $$;

DELETE FROM public.marcosa_worlds
 WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_reports
   WHERE world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')
 OR EXISTS(SELECT 1 FROM marcosa_private.world_cover_appeals
   WHERE world_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')
 THEN RAISE EXCEPTION 'R72: deleted World retained report/appeal data'; END IF;
END $$;
SELECT 'MARCOSA R72 real disposable PostgreSQL 17 complaint and takedown PASS' AS proof;
