-- MARCOSA R156-2: transactionally materialized notification outbox and leased
-- worker claims. NO message is sent, no email/SMS integration is configured.
-- Requires R155 reference and R156 trusted writer.
BEGIN;
CREATE ROLE marcosa_r156_dispatcher NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA marcosa_private TO marcosa_r156_dispatcher;
GRANT SELECT ON public.marcosa_user_blocks TO marcosa_r156_writer;
CREATE POLICY r156_writer_block_read ON public.marcosa_user_blocks
 FOR SELECT TO marcosa_r156_writer USING(true);
GRANT INSERT ON public.marcosa_season_episodes TO marcosa_r156_writer;
CREATE POLICY r156_writer_episode_insert ON public.marcosa_season_episodes
 FOR INSERT TO marcosa_r156_writer WITH CHECK(true);

CREATE TABLE marcosa_private.r156_outbox(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 series_id uuid NOT NULL REFERENCES public.marcosa_seasons(id) ON DELETE CASCADE,
 episode_id uuid NOT NULL REFERENCES public.marcosa_season_episodes(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','acked','dead')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6),
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(episode_id,user_id),
 CHECK((state='leased')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX r156_outbox_pending_idx ON marcosa_private.r156_outbox(state,created_at,id);
CREATE INDEX r156_outbox_user_idx ON marcosa_private.r156_outbox(user_id,series_id);
ALTER TABLE marcosa_private.r156_outbox ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON marcosa_private.r156_outbox TO marcosa_r156_writer;
CREATE POLICY r156_writer_outbox ON marcosa_private.r156_outbox
 FOR ALL TO marcosa_r156_writer USING(true) WITH CHECK(true);
GRANT SELECT,UPDATE(state,attempts,lease_token,lease_until)
 ON marcosa_private.r156_outbox TO marcosa_r156_dispatcher;
CREATE POLICY r156_dispatcher_outbox ON marcosa_private.r156_outbox
 FOR ALL TO marcosa_r156_dispatcher USING(true) WITH CHECK(true);

CREATE FUNCTION marcosa_private.r156_publish_episode(
 p_actor uuid,p_series uuid,p_post uuid,p_episode uuid,p_title text,
 p_expected_revision bigint,p_key uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE cached jsonb; s public.marcosa_seasons%ROWTYPE;
 n integer; recipients integer; result jsonb;
BEGIN
 cached:=marcosa_private.r156_begin_command(p_actor,p_key,'publish',
  jsonb_build_object('series',p_series,'post',p_post,'episode',p_episode,
   'title',p_title,'revision',p_expected_revision));
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 IF p_episode IS NULL OR p_post IS NULL OR p_title IS NULL OR
  char_length(btrim(p_title)) NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'R156 invalid episode'; END IF;
 SELECT * INTO s FROM public.marcosa_seasons WHERE id=p_series FOR UPDATE;
 IF NOT FOUND OR s.owner_id<>p_actor
 THEN RAISE EXCEPTION 'R156 publishing foreign series forbidden' USING ERRCODE='42501'; END IF;
 IF s.archived_at IS NOT NULL OR s.revision<>p_expected_revision
 THEN RAISE EXCEPTION 'R156 archived or stale publishing request'; END IF;
 SELECT coalesce(max(position),0)+1 INTO n FROM public.marcosa_season_episodes
  WHERE series_id=p_series;
 IF n>500 THEN RAISE EXCEPTION 'R156 episode limit exceeded'; END IF;
 -- R155 trusted guard verifies post ownership, publication and source world.
 INSERT INTO public.marcosa_season_episodes(id,series_id,post_id,position,title)
 VALUES(p_episode,p_series,p_post,n,btrim(p_title));
 UPDATE public.marcosa_seasons SET revision=revision+1 WHERE id=p_series;
 INSERT INTO public.marcosa_season_audit(id,series_id,actor_id,action,details)
 VALUES(gen_random_uuid(),p_series,p_actor,'episode_attached',
  jsonb_build_object('episodeId',p_episode,'position',n,'revision',s.revision+1));
 -- No notifications to muted, blocked, archived or private-world readers.
 INSERT INTO marcosa_private.r156_outbox(series_id,episode_id,user_id)
 SELECT p_series,p_episode,sub.user_id FROM public.marcosa_season_subscriptions sub
 JOIN public.marcosa_worlds w ON w.id=s.world_id
 WHERE sub.series_id=p_series AND sub.muted=false AND w.visibility='public'
  AND sub.user_id<>p_actor
  AND NOT EXISTS(SELECT 1 FROM public.marcosa_user_blocks bl
   WHERE (bl.blocker_id=sub.user_id AND bl.blocked_id=p_actor) OR
    (bl.blocker_id=p_actor AND bl.blocked_id=sub.user_id))
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS recipients=ROW_COUNT;
 result:=jsonb_build_object('episodeId',p_episode,'revision',s.revision+1,
  'position',n,'notificationJobs',recipients,'externalDeliveryAttempted',false);
 PERFORM marcosa_private.r156_complete_command(p_actor,p_key,result);
 RETURN result;
END;
$body$;

CREATE FUNCTION marcosa_private.r156_claim(
 p_worker text,p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 60)
 RETURNS TABLE(id bigint,episode_id uuid,user_id uuid,lease_token uuid,
               leased_until timestamptz,attempts integer)
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
BEGIN
 IF p_worker IS NULL OR p_worker !~ '^[a-z][a-z0-9_-]{3,39}$'
   OR p_limit NOT BETWEEN 1 AND 50 OR p_lease_seconds NOT BETWEEN 5 AND 600
 THEN RAISE EXCEPTION 'R156 invalid worker lease request'; END IF;
 RETURN QUERY
 WITH eligible AS(
  SELECT q.id FROM marcosa_private.r156_outbox q
  JOIN public.marcosa_seasons s ON s.id=q.series_id
  JOIN public.marcosa_worlds w ON w.id=s.world_id
  JOIN public.marcosa_season_subscriptions sub
   ON sub.series_id=q.series_id AND sub.user_id=q.user_id
  WHERE (q.state='pending' OR (q.state='leased' AND q.lease_until<clock_timestamp()))
   AND q.attempts<6 AND s.archived_at IS NULL AND w.visibility='public'
   AND sub.muted=false
   AND NOT EXISTS(SELECT 1 FROM public.marcosa_user_blocks bl
    WHERE (bl.blocker_id=q.user_id AND bl.blocked_id=s.owner_id)
     OR (bl.blocker_id=s.owner_id AND bl.blocked_id=q.user_id))
  ORDER BY q.created_at,q.id
  LIMIT p_limit FOR UPDATE OF q SKIP LOCKED
 )
 UPDATE marcosa_private.r156_outbox q
 SET state='leased',attempts=q.attempts+1,lease_token=gen_random_uuid(),
  lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds)
 FROM eligible e WHERE q.id=e.id
 RETURNING q.id,q.episode_id,q.user_id,q.lease_token,q.lease_until,q.attempts;
END;
$body$;
CREATE FUNCTION marcosa_private.r156_ack(p_id bigint,p_token uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE changed bigint;
BEGIN
 IF p_id IS NULL OR p_token IS NULL THEN RETURN false; END IF;
 UPDATE marcosa_private.r156_outbox q SET state='acked',lease_token=NULL,lease_until=NULL
 WHERE q.id=p_id AND q.state='leased' AND q.lease_token=p_token
  AND q.lease_until>clock_timestamp()
  AND EXISTS(
   SELECT 1 FROM public.marcosa_seasons s
    JOIN public.marcosa_worlds w ON w.id=s.world_id
    JOIN public.marcosa_season_subscriptions sub ON sub.series_id=s.id
   WHERE s.id=q.series_id AND sub.user_id=q.user_id AND sub.muted=false
    AND s.archived_at IS NULL AND w.visibility='public');
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1;
END;
$body$;
CREATE FUNCTION marcosa_private.r156_nack(p_id bigint,p_token uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE changed bigint;
BEGIN
 IF p_id IS NULL OR p_token IS NULL THEN RETURN false; END IF;
 UPDATE marcosa_private.r156_outbox
 SET state=CASE WHEN attempts>=6 THEN 'dead' ELSE 'pending' END,
  lease_token=NULL,lease_until=NULL
 WHERE id=p_id AND state='leased' AND lease_token=p_token;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1;
END;
$body$;
REVOKE ALL ON FUNCTION marcosa_private.r156_publish_episode(uuid,uuid,uuid,uuid,text,bigint,uuid)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION marcosa_private.r156_claim(text,integer,integer),
 marcosa_private.r156_ack(bigint,uuid),marcosa_private.r156_nack(bigint,uuid)
 FROM PUBLIC,anon,authenticated,marcosa_r156_writer;
GRANT EXECUTE ON FUNCTION marcosa_private.r156_publish_episode(uuid,uuid,uuid,uuid,text,bigint,uuid)
 TO marcosa_r156_writer;
GRANT EXECUTE ON FUNCTION marcosa_private.r156_claim(text,integer,integer),
 marcosa_private.r156_ack(bigint,uuid),marcosa_private.r156_nack(bigint,uuid)
 TO marcosa_r156_dispatcher;
COMMIT;
