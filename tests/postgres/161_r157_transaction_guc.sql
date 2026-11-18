-- R157 actual PG17 transaction-local actor and role proof, in disposable CI.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF current_database()<>'postgres'
 THEN RAISE EXCEPTION 'R157 rejects non-disposable database'; END IF;
END $$;
BEGIN;
SET LOCAL statement_timeout='4000ms';
SET LOCAL ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub',
 '15600000-0000-4156-8156-000000000001',true);
DO $$
BEGIN
 IF current_user<>'marcosa_r156_writer'
  OR auth.uid()<>'15600000-0000-4156-8156-000000000001'::uuid
 THEN RAISE EXCEPTION 'R157 trusted actor not transaction-scoped'; END IF;
END $$;
SELECT marcosa_private.r156_edit_series(
 '15600000-0000-4156-8156-000000000001',
 '15600000-0000-4156-8156-000000000303',
 1,'R157 isolated API proof','verified transaction-local claim',
 '15700000-0000-4157-8157-000000000441');
COMMIT;
DO $$
BEGIN
 IF current_user<>'postgres' OR
  coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),'')<>''
 THEN RAISE EXCEPTION 'R157 actor or role leaked after COMMIT'; END IF;
 IF (SELECT revision FROM public.marcosa_seasons WHERE id=
  '15600000-0000-4156-8156-000000000303')<>2
 THEN RAISE EXCEPTION 'R157 committed revision missing'; END IF;
END $$;

-- Same token and payload must reuse the previous response, not reapply it.
BEGIN;
SET LOCAL ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub',
 '15600000-0000-4156-8156-000000000001',true);
SELECT marcosa_private.r156_edit_series(
 '15600000-0000-4156-8156-000000000001',
 '15600000-0000-4156-8156-000000000303',
 1,'R157 isolated API proof','verified transaction-local claim',
 '15700000-0000-4157-8157-000000000441');
COMMIT;
DO $$
BEGIN
 IF (SELECT revision FROM public.marcosa_seasons WHERE id=
  '15600000-0000-4156-8156-000000000303')<>2
 THEN RAISE EXCEPTION 'R157 duplicate command applied after retry'; END IF;
END $$;

-- A successful SQL call inside a rolled back transaction may not persist
-- the idempotency journal, audit or any new revision.
BEGIN;
SET LOCAL ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub',
 '15600000-0000-4156-8156-000000000001',true);
SELECT marcosa_private.r156_edit_series(
 '15600000-0000-4156-8156-000000000001',
 '15600000-0000-4156-8156-000000000303',
 2,'MUST NOT PERSIST','rollback simulation',
 '15700000-0000-4157-8157-000000000442');
ROLLBACK;
DO $$
BEGIN
 IF current_user<>'postgres'
  OR coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),'')<>''
 THEN RAISE EXCEPTION 'R157 actor or role leaked after ROLLBACK'; END IF;
 IF (SELECT revision FROM public.marcosa_seasons WHERE id=
  '15600000-0000-4156-8156-000000000303')<>2
  OR EXISTS(SELECT 1 FROM marcosa_private.r156_commands WHERE request_key=
   '15700000-0000-4157-8157-000000000442')
  OR EXISTS(SELECT 1 FROM public.marcosa_season_audit a
   WHERE a.series_id='15600000-0000-4156-8156-000000000303'
     AND a.details->>'newRevision'='3')
 THEN RAISE EXCEPTION 'R157 rollback persisted mutation/audit/dedupe claim'; END IF;
END $$;
SELECT 'R157 actual PostgreSQL SET LOCAL role/actor, COMMIT, retry and ROLLBACK PASS' AS proof;
