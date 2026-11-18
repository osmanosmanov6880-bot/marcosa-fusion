-- MARCOSA R156-3: private transactional reader controls and publication withdrawal.
-- Required order: R155 -> R156 trusted writer -> R156 outbox -> this reference.
-- Private SECURITY INVOKER routines are callable ONLY by a trusted NOLOGIN
-- writer role. Real JWT/session verification is still a production blocker.
BEGIN;
CREATE FUNCTION marcosa_private.r156_reader_allowed(p_actor uuid,p_series uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $body$
 SELECT p_actor IS NOT NULL AND p_actor=(SELECT auth.uid())
 AND EXISTS(
  SELECT 1 FROM public.marcosa_seasons s
   JOIN public.marcosa_worlds w ON w.id=s.world_id
  WHERE s.id=p_series AND s.archived_at IS NULL
   AND (s.owner_id=p_actor OR (w.visibility='public' AND
    marcosa_authz.interaction_allowed(p_actor,s.owner_id)))
 );
$body$;

-- Subscription changes never replay old notifications. Leave/mute also
-- invalidate already-leased jobs; no hidden personal roster is returned.
CREATE FUNCTION marcosa_private.r156_subscription(
 p_actor uuid,p_series uuid,p_mode text,p_key uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE cached jsonb; s public.marcosa_seasons%ROWTYPE; changed bigint; muted boolean;
 result jsonb;
BEGIN
 cached:=marcosa_private.r156_begin_command(p_actor,p_key,'subscribe',
  jsonb_build_object('series',p_series,'mode',p_mode));
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 IF p_mode NOT IN ('join','mute','unmute','leave') OR p_mode IS NULL
 THEN RAISE EXCEPTION 'R156 invalid subscription operation'; END IF;
 SELECT * INTO s FROM public.marcosa_seasons WHERE id=p_series FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'R156 season not found'; END IF;
 IF s.owner_id=p_actor THEN RAISE EXCEPTION 'R156 author cannot subscribe to own season'; END IF;
 IF p_mode='leave' THEN
  DELETE FROM public.marcosa_season_subscriptions WHERE series_id=p_series AND user_id=p_actor;
  GET DIAGNOSTICS changed=ROW_COUNT;
  DELETE FROM marcosa_private.r156_outbox WHERE series_id=p_series AND user_id=p_actor AND state<>'acked';
  result:=jsonb_build_object('subscribed',false,'changed',changed=1);
 ELSIF p_mode='mute' THEN
  UPDATE public.marcosa_season_subscriptions SET muted=true
   WHERE series_id=p_series AND user_id=p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'R156 must join before muting'; END IF;
  DELETE FROM marcosa_private.r156_outbox
   WHERE series_id=p_series AND user_id=p_actor AND state<>'acked';
  result:=jsonb_build_object('subscribed',true,'muted',true,'backfilled',false);
 ELSIF p_mode='unmute' THEN
  IF NOT marcosa_private.r156_reader_allowed(p_actor,p_series)
  THEN RAISE EXCEPTION 'R156 season unavailable for unmute'; END IF;
  UPDATE public.marcosa_season_subscriptions SET muted=false
   WHERE series_id=p_series AND user_id=p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'R156 must join before unmuting'; END IF;
  result:=jsonb_build_object('subscribed',true,'muted',false,'backfilled',false);
 ELSE
  IF NOT marcosa_private.r156_reader_allowed(p_actor,p_series)
  THEN RAISE EXCEPTION 'R156 season unavailable for join'; END IF;
  INSERT INTO public.marcosa_season_subscriptions(series_id,user_id)
   VALUES(p_series,p_actor) ON CONFLICT DO NOTHING;
  SELECT sub.muted INTO muted FROM public.marcosa_season_subscriptions sub
   WHERE sub.series_id=p_series AND sub.user_id=p_actor;
  result:=jsonb_build_object('subscribed',true,'muted',muted,'backfilled',false);
 END IF;
 PERFORM marcosa_private.r156_complete_command(p_actor,p_key,result);
 RETURN result;
END;
$body$;

CREATE FUNCTION marcosa_private.r156_bookmark(
 p_actor uuid,p_episode uuid,p_save boolean,p_key uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE cached jsonb; s public.marcosa_seasons%ROWTYPE;
 source_status text; changed bigint; result jsonb;
BEGIN
 cached:=marcosa_private.r156_begin_command(p_actor,p_key,'bookmark',
  jsonb_build_object('episode',p_episode,'save',p_save));
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 IF p_save IS NULL OR p_episode IS NULL
 THEN RAISE EXCEPTION 'R156 invalid bookmark operation'; END IF;
 IF NOT p_save THEN
  DELETE FROM public.marcosa_season_bookmarks WHERE episode_id=p_episode AND user_id=p_actor;
  GET DIAGNOSTICS changed=ROW_COUNT;
  result:=jsonb_build_object('saved',false,'removed',changed=1);
 ELSE
  SELECT s.*,p.status INTO s,source_status
   FROM public.marcosa_season_episodes e
   JOIN public.marcosa_seasons s ON s.id=e.series_id
   JOIN public.marcosa_posts p ON p.id=e.post_id
   WHERE e.id=p_episode;
  IF NOT FOUND OR source_status<>'published'
   OR NOT marcosa_private.r156_reader_allowed(p_actor,s.id)
  THEN RAISE EXCEPTION 'R156 unavailable episode cannot be saved'; END IF;
  INSERT INTO public.marcosa_season_bookmarks(episode_id,user_id) VALUES(p_episode,p_actor)
   ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS changed=ROW_COUNT;
  result:=jsonb_build_object('saved',true,'added',changed=1);
 END IF;
 PERFORM marcosa_private.r156_complete_command(p_actor,p_key,result);
 RETURN result;
END;
$body$;

-- Recording a voluntary reading mark is opt-in. Withdrawal remains possible
-- even after an author archives, a world becomes private, or a block is set.
CREATE FUNCTION marcosa_private.r156_attendance(
 p_actor uuid,p_episode uuid,p_present boolean,p_key uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE cached jsonb; s public.marcosa_seasons%ROWTYPE;
 source_status text; changed bigint; result jsonb;
BEGIN
 cached:=marcosa_private.r156_begin_command(p_actor,p_key,'attendance',
  jsonb_build_object('episode',p_episode,'present',p_present));
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 IF p_episode IS NULL OR p_present IS NULL
 THEN RAISE EXCEPTION 'R156 invalid attendance operation'; END IF;
 IF p_present THEN
  SELECT s.*,p.status INTO s,source_status
   FROM public.marcosa_season_episodes e
   JOIN public.marcosa_seasons s ON s.id=e.series_id
   JOIN public.marcosa_posts p ON p.id=e.post_id WHERE e.id=p_episode;
  IF NOT FOUND OR source_status<>'published' OR s.owner_id=p_actor
   OR NOT marcosa_private.r156_reader_allowed(p_actor,s.id)
  THEN RAISE EXCEPTION 'R156 attendance consent unavailable'; END IF;
  INSERT INTO public.marcosa_season_attendance(episode_id,viewer_id)
    VALUES(p_episode,p_actor) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS changed=ROW_COUNT;
  result:=jsonb_build_object('present',true,'added',changed=1);
 ELSE
  DELETE FROM public.marcosa_season_attendance
   WHERE episode_id=p_episode AND viewer_id=p_actor;
  GET DIAGNOSTICS changed=ROW_COUNT;
  result:=jsonb_build_object('present',false,'removed',changed=1);
 END IF;
 PERFORM marcosa_private.r156_complete_command(p_actor,p_key,result);
 RETURN result;
END;
$body$;

CREATE FUNCTION marcosa_private.r156_publication(
 p_actor uuid,p_series uuid,p_publish boolean,p_expected_revision bigint,
 p_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE cached jsonb; s public.marcosa_seasons%ROWTYPE; removed bigint; result jsonb;
BEGIN
 cached:=marcosa_private.r156_begin_command(p_actor,p_key,'archive',
  jsonb_build_object('series',p_series,'publish',p_publish,'revision',p_expected_revision));
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 IF p_publish IS NULL THEN RAISE EXCEPTION 'R156 missing publication state'; END IF;
 SELECT * INTO s FROM public.marcosa_seasons WHERE id=p_series FOR UPDATE;
 IF NOT FOUND OR s.owner_id<>p_actor
 THEN RAISE EXCEPTION 'R156 only owner can change publication' USING ERRCODE='42501'; END IF;
 IF s.revision<>p_expected_revision THEN RAISE EXCEPTION 'R156 stale publication revision'; END IF;
 IF p_publish=(s.archived_at IS NULL)
 THEN RAISE EXCEPTION 'R156 publication already in requested state'; END IF;
 UPDATE public.marcosa_seasons
  SET archived_at=CASE WHEN p_publish THEN NULL ELSE clock_timestamp() END,
      revision=revision+1 WHERE id=p_series;
 IF NOT p_publish THEN
  DELETE FROM marcosa_private.r156_outbox
   WHERE series_id=p_series AND state<>'acked';
  GET DIAGNOSTICS removed=ROW_COUNT;
 ELSE removed:=0; END IF;
 INSERT INTO public.marcosa_season_audit(id,series_id,actor_id,action,details)
 VALUES(gen_random_uuid(),p_series,p_actor,
  CASE WHEN p_publish THEN 'series_restored' ELSE 'series_archived' END,
  jsonb_build_object('revision',s.revision+1,'jobsRevoked',removed));
 result:=jsonb_build_object('published',p_publish,'revision',s.revision+1,
  'jobsRevoked',removed,'oldMessagesBackfilled',false);
 PERFORM marcosa_private.r156_complete_command(p_actor,p_key,result);
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION marcosa_private.r156_reader_allowed(uuid,uuid),
 marcosa_private.r156_subscription(uuid,uuid,text,uuid),
 marcosa_private.r156_bookmark(uuid,uuid,boolean,uuid),
 marcosa_private.r156_attendance(uuid,uuid,boolean,uuid),
 marcosa_private.r156_publication(uuid,uuid,boolean,bigint,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION marcosa_private.r156_reader_allowed(uuid,uuid),
 marcosa_private.r156_subscription(uuid,uuid,text,uuid),
 marcosa_private.r156_bookmark(uuid,uuid,boolean,uuid),
 marcosa_private.r156_attendance(uuid,uuid,boolean,uuid),
 marcosa_private.r156_publication(uuid,uuid,boolean,bigint,uuid)
 TO marcosa_r156_writer;
COMMIT;
