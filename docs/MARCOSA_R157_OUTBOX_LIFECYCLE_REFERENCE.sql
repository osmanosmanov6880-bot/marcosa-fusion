-- MARCOSA R157 outbox lifecycle hardening, disposable PG17 reference only.
-- R156 expires a sixth leased attempt but never reclaims it (attempts<6).
-- This repair adds bounded sweep, revocation cancellation and a pre-delivery
-- eligibility fence. No external notification provider is connected.
BEGIN;
CREATE FUNCTION marcosa_private.r157_eligible(
 p_series uuid,p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $body$
 SELECT EXISTS(
  SELECT 1 FROM public.marcosa_seasons s
  JOIN public.marcosa_worlds w ON w.id=s.world_id
  JOIN public.marcosa_season_subscriptions sub
    ON sub.series_id=s.id AND sub.user_id=p_user AND sub.muted=false
  WHERE s.id=p_series AND s.archived_at IS NULL AND w.visibility='public'
    AND NOT EXISTS(SELECT 1 FROM public.marcosa_user_blocks bl WHERE
      (bl.blocker_id=p_user AND bl.blocked_id=s.owner_id) OR
      (bl.blocker_id=s.owner_id AND bl.blocked_id=p_user))
 );
$body$;

CREATE FUNCTION marcosa_private.r157_delivery_fence(
 p_id bigint,p_token uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $body$
 SELECT EXISTS(SELECT 1 FROM marcosa_private.r156_outbox q
  WHERE q.id=p_id AND q.state='leased' AND q.lease_token=p_token
   AND q.lease_until>clock_timestamp()
   AND marcosa_private.r157_eligible(q.series_id,q.user_id));
$body$;
CREATE FUNCTION marcosa_private.r157_cancel(
 p_id bigint,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE changed bigint;
BEGIN
 IF p_id IS NULL OR p_token IS NULL THEN RETURN false; END IF;
 UPDATE marcosa_private.r156_outbox
 SET state='dead',lease_token=NULL,lease_until=NULL
 WHERE id=p_id AND lease_token=p_token AND state='leased';
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1;
END;
$body$;
CREATE FUNCTION marcosa_private.r157_sweep(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE changed integer;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 500 OR p_limit IS NULL
 THEN RAISE EXCEPTION 'R157 sweep limit out of bounds'; END IF;
 WITH candidates AS(
  SELECT q.id FROM marcosa_private.r156_outbox q
   WHERE (q.state IN ('pending','leased') AND NOT
     marcosa_private.r157_eligible(q.series_id,q.user_id))
    OR (q.state='leased' AND q.lease_until<clock_timestamp() AND q.attempts>=6)
   ORDER BY q.id LIMIT p_limit FOR UPDATE OF q SKIP LOCKED
 )
 UPDATE marcosa_private.r156_outbox q
 SET state='dead',lease_token=NULL,lease_until=NULL
 FROM candidates c WHERE c.id=q.id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed;
END;
$body$;
CREATE FUNCTION marcosa_private.r157_queue_health()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $body$
 SELECT jsonb_build_object(
  'pending',count(*) FILTER(WHERE state='pending'),
  'leased',count(*) FILTER(WHERE state='leased'),
  'acked',count(*) FILTER(WHERE state='acked'),
  'dead',count(*) FILTER(WHERE state='dead'),
  'expired',count(*) FILTER(
    WHERE state='leased' AND lease_until<clock_timestamp()),
  'exhausted',count(*) FILTER(
    WHERE state='leased' AND attempts>=6 AND lease_until<clock_timestamp()))
 FROM marcosa_private.r156_outbox;
$body$;
REVOKE ALL ON FUNCTION
 marcosa_private.r157_eligible(uuid,uuid),
 marcosa_private.r157_delivery_fence(bigint,uuid),
 marcosa_private.r157_cancel(bigint,uuid),
 marcosa_private.r157_sweep(integer),
 marcosa_private.r157_queue_health()
 FROM PUBLIC,anon,authenticated,marcosa_r156_writer;
GRANT EXECUTE ON FUNCTION
 marcosa_private.r157_eligible(uuid,uuid),
 marcosa_private.r157_delivery_fence(bigint,uuid),
 marcosa_private.r157_cancel(bigint,uuid),
 marcosa_private.r157_sweep(integer),
 marcosa_private.r157_queue_health()
 TO marcosa_r156_dispatcher;
COMMIT;
