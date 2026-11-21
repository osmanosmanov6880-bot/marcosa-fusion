-- R157 real PostgreSQL 17: expired six-try leases, revocation and fenced dispatch.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF has_function_privilege('authenticated',
  'marcosa_private.r157_cancel(bigint,uuid)','EXECUTE')
 OR has_function_privilege('anon',
  'marcosa_private.r157_queue_health()','EXECUTE')
 THEN RAISE EXCEPTION 'R157 private outbox controls exposed to client role'; END IF;
 IF (SELECT rolcanlogin OR rolbypassrls FROM pg_roles WHERE rolname='marcosa_r156_dispatcher')
 THEN RAISE EXCEPTION 'R157 dispatcher role not isolated'; END IF;
END $$;

-- R156 race temporarily reopened an archive to test SKIP LOCKED, then restored.
-- Its still leased notification must be cancelled, not re-dispatched.
SET ROLE marcosa_r156_dispatcher;
DO $$
DECLARE leased_id bigint; token uuid; health jsonb;
BEGIN
 SELECT id,lease_token INTO leased_id,token
 FROM marcosa_private.r156_outbox WHERE state='leased';
 IF leased_id IS NULL OR token IS NULL THEN
  RAISE EXCEPTION 'R157 expected an R156 leased fixture'; END IF;
 IF marcosa_private.r157_delivery_fence(leased_id,token)
 THEN RAISE EXCEPTION 'R157 archived recipient passed delivery fence'; END IF;
 IF marcosa_private.r157_cancel(leased_id,gen_random_uuid())
 THEN RAISE EXCEPTION 'R157 wrong token cancelled lease'; END IF;
 IF marcosa_private.r157_sweep(50)<>1
 THEN RAISE EXCEPTION 'R157 failed to dead-letter archived leased job'; END IF;
 IF marcosa_private.r157_cancel(leased_id,token)
 THEN RAISE EXCEPTION 'R157 stale cancellation token reused'; END IF;
 IF marcosa_private.r157_sweep(50)<>0
 THEN RAISE EXCEPTION 'R157 sweep not idempotent'; END IF;
 health:=marcosa_private.r157_queue_health();
 IF health->>'dead'<>'1' OR health->>'acked'<>'1'
 THEN RAISE EXCEPTION 'R157 queue health incorrect after privacy revocation: %',health; END IF;
 BEGIN
  PERFORM marcosa_private.r157_sweep(501);
  RAISE EXCEPTION 'R157 accepted unbounded sweep';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%out of bounds%' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;

-- Fresh synthetic, published episode in the R156 race season: eligible for Bob
-- until he is blocked or unsubscribes.
INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status) VALUES(
 '15700000-0000-4157-8157-000000000211',
 '15600000-0000-4156-8156-000000000101',
 '15600000-0000-4156-8156-000000000001',
 'R157 rehearsal only','published'
);
INSERT INTO public.marcosa_season_episodes(id,series_id,post_id,position,title) VALUES(
 '15700000-0000-4157-8157-000000000212',
 '15600000-0000-4156-8156-000000000303',
 '15700000-0000-4157-8157-000000000211',
 1,'R157 race season'
);
INSERT INTO public.marcosa_season_subscriptions(series_id,user_id,muted) VALUES(
 '15600000-0000-4156-8156-000000000303',
 '15600000-0000-4156-8156-000000000002',false
);
INSERT INTO marcosa_private.r156_outbox(series_id,episode_id,user_id,
 state,attempts,lease_token,lease_until) VALUES(
 '15600000-0000-4156-8156-000000000303',
 '15700000-0000-4157-8157-000000000212',
 '15600000-0000-4156-8156-000000000002',
 'leased',6,'15700000-0000-4157-8157-000000000213',clock_timestamp()-interval '2 minutes'
);
SET ROLE marcosa_r156_dispatcher;
DO $$
DECLARE pending bigint; health jsonb;
BEGIN
 SELECT id INTO pending FROM marcosa_private.r156_outbox
 WHERE episode_id='15700000-0000-4157-8157-000000000212';
 IF pending IS NULL OR NOT marcosa_private.r157_eligible(
  '15600000-0000-4156-8156-000000000303',
  '15600000-0000-4156-8156-000000000002')
 THEN RAISE EXCEPTION 'R157 eligible source fixture missing'; END IF;
 IF marcosa_private.r157_sweep(50)<>1
 THEN RAISE EXCEPTION 'R157 exhausted lease was left stranded'; END IF;
 IF EXISTS(SELECT 1 FROM marcosa_private.r156_claim('r157_sweep_worker',10,60))
 THEN RAISE EXCEPTION 'R157 exhausted lease was reclaimed'; END IF;
 health:=marcosa_private.r157_queue_health();
 IF health->>'dead'<>'2' OR health->>'exhausted'<>'0'
 THEN RAISE EXCEPTION 'R157 exhausted counter still nonzero: %',health; END IF;
END $$;
RESET ROLE;

-- A newly leased job passes its delivery fence when eligible. Revoking
-- subscription then invalidates its token immediately, before any transport.
INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status) VALUES(
 '15700000-0000-4157-8157-000000000221',
 '15600000-0000-4156-8156-000000000101',
 '15600000-0000-4156-8156-000000000001',
 'R157 final rehearsal','published'
);
INSERT INTO public.marcosa_season_episodes(id,series_id,post_id,position,title) VALUES(
 '15700000-0000-4157-8157-000000000222',
 '15600000-0000-4156-8156-000000000303',
 '15700000-0000-4157-8157-000000000221',
 2,'R157 revocation story'
);
INSERT INTO marcosa_private.r156_outbox(series_id,episode_id,user_id) VALUES(
 '15600000-0000-4156-8156-000000000303',
 '15700000-0000-4157-8157-000000000222',
 '15600000-0000-4156-8156-000000000002'
);
SET ROLE marcosa_r156_dispatcher;
DO $$
DECLARE q record;
BEGIN
 SELECT * INTO q FROM marcosa_private.r156_claim('r157_recipient',10,60);
 IF q.id IS NULL OR NOT marcosa_private.r157_delivery_fence(q.id,q.lease_token)
 THEN RAISE EXCEPTION 'R157 active consent was incorrectly rejected'; END IF;
END $$;
RESET ROLE;
UPDATE public.marcosa_season_subscriptions SET muted=true
 WHERE series_id='15600000-0000-4156-8156-000000000303'
 AND user_id='15600000-0000-4156-8156-000000000002';
SET ROLE marcosa_r156_dispatcher;
DO $$
DECLARE q record;
BEGIN
 SELECT * INTO q FROM marcosa_private.r156_outbox WHERE
  episode_id='15700000-0000-4157-8157-000000000222';
 IF marcosa_private.r157_delivery_fence(q.id,q.lease_token)
 THEN RAISE EXCEPTION 'R157 revoked user still eligible at delivery'; END IF;
 IF marcosa_private.r156_ack(q.id,q.lease_token)
 THEN RAISE EXCEPTION 'R157 revoked user was acknowledged'; END IF;
 IF NOT marcosa_private.r157_cancel(q.id,q.lease_token)
 THEN RAISE EXCEPTION 'R157 cancellation failed after consent revoked'; END IF;
 IF marcosa_private.r157_cancel(q.id,q.lease_token)
 THEN RAISE EXCEPTION 'R157 duplicate cancellation accepted'; END IF;
 IF (marcosa_private.r157_queue_health()->>'dead')<>'3'
 THEN RAISE EXCEPTION 'R157 cancelled job missing from counts'; END IF;
END $$;
RESET ROLE;
SELECT 'R157 PostgreSQL revoked/expired outbox, delivery fence and DEAD cleanup PASS' AS proof;
