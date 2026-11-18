-- R159 real PostgreSQL 17: session read permissions and final consent fence.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database()<>'postgres' THEN RAISE EXCEPTION 'R159 refuses non-disposable database'; END IF;
END $$;
CREATE POLICY r159_test_auth_reader ON auth.sessions
 FOR SELECT TO marcosa_r159_auth_reader USING(true);
DO $$
BEGIN
 IF (SELECT rolcanlogin OR rolbypassrls FROM pg_roles WHERE rolname='marcosa_r159_auth_reader')
 THEN RAISE EXCEPTION 'R159 session reader is login capable or bypasses RLS'; END IF;
 IF has_table_privilege('anon','auth.sessions','SELECT')
  OR has_table_privilege('authenticated','auth.sessions','SELECT')
  OR has_table_privilege('marcosa_r156_writer','auth.sessions','SELECT')
 THEN RAISE EXCEPTION 'R159 session roster leaked to browser or content writer'; END IF;
END $$;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM count(*) FROM auth.sessions;
  RAISE EXCEPTION 'R159 browser could inspect Supabase Auth sessions';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET ROLE marcosa_r159_auth_reader;
DO $$
BEGIN
 IF (SELECT count(*) FROM auth.sessions)<>2
 THEN RAISE EXCEPTION 'R159 session reader failed explicit grants/RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions WHERE
  id='15900000-0000-4159-8159-000000000501'
  AND user_id='15900000-0000-4159-8159-000000000001')
 THEN RAISE EXCEPTION 'R159 signed JWT session_id does not map to subject'; END IF;
 IF EXISTS(SELECT 1 FROM auth.sessions WHERE
  id='15900000-0000-4159-8159-000000000501'
  AND user_id='15900000-0000-4159-8159-000000000002')
 THEN RAISE EXCEPTION 'R159 reader sees mismatched session ownership'; END IF;
 BEGIN
  PERFORM created_at FROM auth.sessions LIMIT 1;
  RAISE EXCEPTION 'R159 session reader can access fields beyond id/user_id';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
DELETE FROM auth.sessions WHERE id='15900000-0000-4159-8159-000000000502';
SET ROLE marcosa_r159_auth_reader;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM auth.sessions WHERE id=
  '15900000-0000-4159-8159-000000000502')
 THEN RAISE EXCEPTION 'R159 signed-out reader session still valid'; END IF;
END $$;
RESET ROLE;

-- Compare a real worker claim and a consent change in between lease and send.
SET ROLE marcosa_r156_dispatcher;
SELECT id AS jobid,lease_token AS leasetoken
 FROM marcosa_private.r156_claim('r159_test_worker',1,60) \gset
DO $$ BEGIN
 IF (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='leased')<>1
 THEN RAISE EXCEPTION 'R159 expected exactly one eligible leased task'; END IF;
END $$;
SELECT 1 / CASE WHEN marcosa_private.r157_delivery_fence(:'jobid'::bigint,:'leasetoken'::uuid)
 THEN 1 ELSE 0 END AS initial_fence_proof;
RESET ROLE;
UPDATE public.marcosa_season_subscriptions SET muted=true
 WHERE series_id='15900000-0000-4159-8159-000000000301'
 AND user_id='15900000-0000-4159-8159-000000000002';
SET ROLE marcosa_r156_dispatcher;
SELECT 1 / CASE WHEN NOT marcosa_private.r157_delivery_fence(:'jobid'::bigint,:'leasetoken'::uuid)
 THEN 1 ELSE 0 END AS revoked_fence_proof;
SELECT 1 / CASE WHEN marcosa_private.r157_cancel(:'jobid'::bigint,:'leasetoken'::uuid)
 THEN 1 ELSE 0 END AS final_cancellation;
SELECT 1 / CASE WHEN NOT marcosa_private.r156_ack(:'jobid'::bigint,:'leasetoken'::uuid)
 THEN 1 ELSE 0 END AS stale_lease_ack_denied;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='dead')<>1
 OR (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='pending')<>1
 THEN RAISE EXCEPTION 'R159 queue cancellation touched wrong subscriber'; END IF;
END $$;
SELECT 'R159_REAL_PG17_AUTH_SESSION_REVOKE_LEASE_FENCE_CANCEL=PASS' AS proof;
