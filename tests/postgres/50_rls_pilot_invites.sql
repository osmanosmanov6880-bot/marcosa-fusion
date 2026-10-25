-- R46: exercise real PostgreSQL 17 permissions and append-only invite lifecycle.
\set ON_ERROR_STOP on
INSERT INTO marcosa_private.pilot_invites
 (id,code_hash,created_by,label,created_at,expires_at)
VALUES
 ('90000000-0000-4000-8000-000000000001',repeat('a',64),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Creator invitation A',
  now(),now()+interval '12 hours'),
 ('90000000-0000-4000-8000-000000000002',repeat('b',64),
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc','Creator invitation C',
  now(),now()+interval '2 hours');

DO $$
DECLARE n integer;
BEGIN
 IF NOT(SELECT relrowsecurity FROM pg_class
  WHERE oid='marcosa_private.pilot_invites'::regclass)
 THEN RAISE EXCEPTION 'R46 private pilot invites RLS disabled'; END IF;
 IF has_schema_privilege('anon','marcosa_private','USAGE')
  OR has_schema_privilege('authenticated','marcosa_private','USAGE')
 THEN RAISE EXCEPTION 'R46 private schema exposed to Data API'; END IF;
 IF has_table_privilege('anon','marcosa_private.pilot_invites','SELECT')
  OR has_table_privilege('authenticated','marcosa_private.pilot_invites','SELECT')
  OR has_table_privilege('authenticated','marcosa_private.pilot_invites','INSERT')
  OR has_table_privilege('authenticated','marcosa_private.pilot_invites','UPDATE')
  OR has_table_privilege('authenticated','marcosa_private.pilot_invites','DELETE')
 THEN RAISE EXCEPTION 'R46 browser can inspect or rewrite invitations'; END IF;
 SELECT count(*) INTO n FROM pg_policies
 WHERE schemaname='marcosa_private' AND tablename='pilot_invites';
 IF n<>0 THEN RAISE EXCEPTION 'R46 unexpected browser-side invitation policy'; END IF;
END $$;

SET ROLE anon;
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.pilot_invites;
  RAISE EXCEPTION 'R46 anon read a private code hash';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.pilot_invites;
  RAISE EXCEPTION 'R46 creator used public JWT to enumerate invites';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO marcosa_private.pilot_invites(code_hash,created_by,expires_at)
  VALUES(repeat('c',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()+interval '1 hour');
  RAISE EXCEPTION 'R46 creator used JWT to forge invite';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $$
BEGIN
 BEGIN
  UPDATE marcosa_private.pilot_invites SET revoked_at=now()
  WHERE id='90000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'R46 invited user forged revocation through Data API';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

DO $$
DECLARE first_use integer;
DECLARE replay integer;
BEGIN
 UPDATE marcosa_private.pilot_invites SET
  used_by='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', used_at=now()
 WHERE code_hash=repeat('a',64) AND used_at IS NULL AND revoked_at IS NULL
  AND expires_at>now();
 GET DIAGNOSTICS first_use=ROW_COUNT;
 IF first_use<>1 THEN RAISE EXCEPTION 'R46 backend cannot redeem an active invite'; END IF;
 UPDATE marcosa_private.pilot_invites SET
  used_by='cccccccc-cccc-4ccc-8ccc-cccccccccccc', used_at=now()
 WHERE code_hash=repeat('a',64) AND used_at IS NULL AND revoked_at IS NULL
  AND expires_at>now();
 GET DIAGNOSTICS replay=ROW_COUNT;
 IF replay<>0 THEN RAISE EXCEPTION 'R46 invite replay accepted'; END IF;
 BEGIN
  UPDATE marcosa_private.pilot_invites SET revoked_at=now()
  WHERE id='90000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'R46 allowed consumed invite to be revoked';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;

DO $$
BEGIN
 BEGIN
  INSERT INTO marcosa_private.pilot_invites(code_hash,created_by,expires_at)
  VALUES(repeat('a',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()+interval '1 hour');
  RAISE EXCEPTION 'R46 duplicate code hash accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO marcosa_private.pilot_invites(code_hash,created_by,expires_at)
  VALUES('invalid-hash','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()+interval '1 hour');
  RAISE EXCEPTION 'R46 malformed code hash accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO marcosa_private.pilot_invites(code_hash,created_by,expires_at)
  VALUES(repeat('d',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()-interval '1 hour');
  RAISE EXCEPTION 'R46 expired ticket accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO marcosa_private.pilot_invites(code_hash,created_by,expires_at)
  VALUES(repeat('e',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()+interval '200 hours');
  RAISE EXCEPTION 'R46 ticket lifetime exceeded 168-hour cap';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;

DELETE FROM auth.users WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM marcosa_private.pilot_invites
  WHERE code_hash=repeat('a',64) AND used_by IS NULL AND used_at IS NOT NULL)
 THEN RAISE EXCEPTION 'R46 deleting redeemed user reopened or corrupted invite'; END IF;
END $$;
DELETE FROM auth.users WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM marcosa_private.pilot_invites WHERE code_hash=repeat('a',64))
 THEN RAISE EXCEPTION 'R46 creator deletion failed to cascade invites'; END IF;
 IF (SELECT count(*) FROM marcosa_private.pilot_invites)<>1
 THEN RAISE EXCEPTION 'R46 creator deletion impacted unrelated tickets'; END IF;
END $$;
SELECT 'MARCOSA R46: private invites PostgreSQL access and lifecycle PASS' AS proof;
