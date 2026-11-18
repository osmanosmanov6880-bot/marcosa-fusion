-- MARCOSA R156-1. Disposable PostgreSQL 17 ONLY. No live Supabase migration.
-- Installs a NOLOGIN, non-bypass writer. The caller must independently validate
-- its real Auth session before setting transaction-local request.jwt.claim.sub.
-- The caller is NOT identified by this laboratory GUC alone.
BEGIN;
CREATE ROLE marcosa_r156_writer NOLOGIN NOBYPASSRLS;
REVOKE ALL ON SCHEMA marcosa_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA public,marcosa_private,auth,marcosa_authz TO marcosa_r156_writer;
GRANT EXECUTE ON FUNCTION auth.uid() TO marcosa_r156_writer;
GRANT EXECUTE ON FUNCTION marcosa_authz.interaction_allowed(uuid,uuid) TO marcosa_r156_writer;

ALTER TABLE public.marcosa_seasons
 ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0);
-- These grants are ONLY for the isolated private writer role, never browser roles.
GRANT SELECT ON public.marcosa_worlds,public.marcosa_posts TO marcosa_r156_writer;
GRANT SELECT,UPDATE(title,description,archived_at,revision) ON public.marcosa_seasons TO marcosa_r156_writer;
GRANT SELECT,UPDATE(position,title) ON public.marcosa_season_episodes TO marcosa_r156_writer;
GRANT SELECT,INSERT ON public.marcosa_season_audit TO marcosa_r156_writer;
GRANT SELECT,INSERT,DELETE,UPDATE(muted) ON public.marcosa_season_subscriptions TO marcosa_r156_writer;
GRANT SELECT,INSERT,DELETE ON public.marcosa_season_bookmarks TO marcosa_r156_writer;
GRANT SELECT,INSERT,DELETE ON public.marcosa_season_attendance TO marcosa_r156_writer;
CREATE POLICY r156_writer_world_read ON public.marcosa_worlds
 FOR SELECT TO marcosa_r156_writer USING(true);
CREATE POLICY r156_writer_post_read ON public.marcosa_posts
 FOR SELECT TO marcosa_r156_writer USING(true);
CREATE POLICY r156_writer_series_read ON public.marcosa_seasons
 FOR SELECT TO marcosa_r156_writer USING(true);
CREATE POLICY r156_writer_series_update ON public.marcosa_seasons
 FOR UPDATE TO marcosa_r156_writer USING(true) WITH CHECK(true);
CREATE POLICY r156_writer_episodes_read ON public.marcosa_season_episodes
 FOR SELECT TO marcosa_r156_writer USING(true);
CREATE POLICY r156_writer_episodes_update ON public.marcosa_season_episodes
 FOR UPDATE TO marcosa_r156_writer USING(true) WITH CHECK(true);
CREATE POLICY r156_writer_audit ON public.marcosa_season_audit
 FOR ALL TO marcosa_r156_writer USING(true) WITH CHECK(true);
CREATE POLICY r156_writer_subscriptions ON public.marcosa_season_subscriptions
 FOR ALL TO marcosa_r156_writer USING(true) WITH CHECK(true);
CREATE POLICY r156_writer_bookmarks ON public.marcosa_season_bookmarks
 FOR ALL TO marcosa_r156_writer USING(true) WITH CHECK(true);
CREATE POLICY r156_writer_attendance ON public.marcosa_season_attendance
 FOR ALL TO marcosa_r156_writer USING(true) WITH CHECK(true);

CREATE TABLE marcosa_private.r156_commands(
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_key uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN(
  'edit','reorder','publish','archive','mute','subscribe','bookmark','withdraw')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 response jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
CREATE INDEX r156_commands_age ON marcosa_private.r156_commands(created_at);
ALTER TABLE marcosa_private.r156_commands ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE(response) ON marcosa_private.r156_commands TO marcosa_r156_writer;
CREATE POLICY r156_writer_commands ON marcosa_private.r156_commands
 FOR ALL TO marcosa_r156_writer USING(true) WITH CHECK(true);

-- The same actor/key/payload returns the exact same committed result. A
-- conflicting retry fails, and concurrent same-key INSERT waits atomically.
CREATE FUNCTION marcosa_private.r156_begin_command(
 p_actor uuid,p_key uuid,p_operation text,p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE inserted bigint; existing marcosa_private.r156_commands%ROWTYPE;
BEGIN
 IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR p_key IS NULL
 THEN RAISE EXCEPTION 'R156 verified actor is required' USING ERRCODE='42501'; END IF;
 IF p_operation NOT IN ('edit','reorder','publish','archive','mute','subscribe','bookmark','withdraw')
  OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
 THEN RAISE EXCEPTION 'R156 invalid command payload'; END IF;
 INSERT INTO marcosa_private.r156_commands(actor_id,request_key,operation,payload)
  VALUES(p_actor,p_key,p_operation,p_payload) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=1 THEN RETURN NULL; END IF;
 SELECT * INTO existing FROM marcosa_private.r156_commands
  WHERE actor_id=p_actor AND request_key=p_key FOR UPDATE;
 IF NOT FOUND OR existing.operation IS DISTINCT FROM p_operation
  OR existing.payload IS DISTINCT FROM p_payload
 THEN RAISE EXCEPTION 'R156 idempotency key reused for different operation'; END IF;
 IF existing.response IS NULL
 THEN RAISE EXCEPTION 'R156 previous command did not commit'; END IF;
 RETURN existing.response;
END;
$body$;
CREATE FUNCTION marcosa_private.r156_complete_command(
 p_actor uuid,p_key uuid,p_response jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
BEGIN
 IF p_actor IS DISTINCT FROM auth.uid() OR p_response IS NULL
 THEN RAISE EXCEPTION 'R156 command completion identity mismatch' USING ERRCODE='42501'; END IF;
 UPDATE marcosa_private.r156_commands SET response=p_response
  WHERE actor_id=p_actor AND request_key=p_key AND response IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'R156 command completion absent or repeated'; END IF;
END;
$body$;

CREATE FUNCTION marcosa_private.r156_edit_series(
 p_actor uuid,p_series uuid,p_expected_revision bigint,p_title text,
 p_description text,p_key uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE cached jsonb; s public.marcosa_seasons%ROWTYPE; result jsonb;
BEGIN
 cached:=marcosa_private.r156_begin_command(p_actor,p_key,'edit',
  jsonb_build_object('series',p_series,'revision',p_expected_revision,'title',p_title,'description',p_description));
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 100
  OR p_description IS NULL OR char_length(p_description)>600
 THEN RAISE EXCEPTION 'R156 invalid season metadata'; END IF;
 SELECT * INTO s FROM public.marcosa_seasons WHERE id=p_series FOR UPDATE;
 IF NOT FOUND OR s.owner_id<>p_actor
 THEN RAISE EXCEPTION 'R156 season is not owned by actor' USING ERRCODE='42501'; END IF;
 IF s.archived_at IS NOT NULL THEN RAISE EXCEPTION 'R156 archived season cannot be edited'; END IF;
 IF s.revision<>p_expected_revision
 THEN RAISE EXCEPTION 'R156 stale season revision'; END IF;
 UPDATE public.marcosa_seasons SET title=btrim(p_title),description=p_description,revision=revision+1
  WHERE id=p_series;
 INSERT INTO public.marcosa_season_audit(id,series_id,actor_id,action,details)
  VALUES(gen_random_uuid(),p_series,p_actor,'series_updated',
   jsonb_build_object('oldRevision',s.revision,'newRevision',s.revision+1));
 result:=jsonb_build_object('seriesId',p_series,'revision',s.revision+1,'updated',true);
 PERFORM marcosa_private.r156_complete_command(p_actor,p_key,result);
 RETURN result;
END;
$body$;

-- Previous UNIQUE(series_id,position) is non-deferrable in R155. Replacing
-- it with a deferrable constraint allows an atomic full permutation.
ALTER TABLE public.marcosa_season_episodes
 DROP CONSTRAINT marcosa_season_episodes_series_id_position_key;
ALTER TABLE public.marcosa_season_episodes
 ADD CONSTRAINT marcosa_season_episodes_series_id_position_key
 UNIQUE(series_id,position) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION marcosa_private.r156_reorder_episodes(
 p_actor uuid,p_series uuid,p_expected_revision bigint,
 p_order uuid[],p_key uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $body$
DECLARE cached jsonb; s public.marcosa_seasons%ROWTYPE; n integer; result jsonb;
BEGIN
 cached:=marcosa_private.r156_begin_command(p_actor,p_key,'reorder',
  jsonb_build_object('series',p_series,'revision',p_expected_revision,'order',p_order));
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 n:=coalesce(cardinality(p_order),0);
 IF n<1 OR n>500
 THEN RAISE EXCEPTION 'R156 order must contain 1-500 episodes'; END IF;
 SELECT * INTO s FROM public.marcosa_seasons WHERE id=p_series FOR UPDATE;
 IF NOT FOUND OR s.owner_id<>p_actor
 THEN RAISE EXCEPTION 'R156 reorder denied to foreign actor' USING ERRCODE='42501'; END IF;
 IF s.archived_at IS NOT NULL OR s.revision<>p_expected_revision
 THEN RAISE EXCEPTION 'R156 archived/stale reorder'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_episodes WHERE series_id=p_series)<>n
 OR (SELECT count(DISTINCT x) FROM unnest(p_order) x)<>n
 OR (SELECT count(*) FROM public.marcosa_season_episodes
      WHERE series_id=p_series AND id=ANY(p_order))<>n
 THEN RAISE EXCEPTION 'R156 order does not match all owned episodes'; END IF;
 UPDATE public.marcosa_season_episodes e SET position=u.ordinality
  FROM unnest(p_order) WITH ORDINALITY AS u(id,ordinality)
  WHERE e.series_id=p_series AND e.id=u.id;
 UPDATE public.marcosa_seasons SET revision=revision+1 WHERE id=p_series;
 INSERT INTO public.marcosa_season_audit(id,series_id,actor_id,action,details)
 VALUES(gen_random_uuid(),p_series,p_actor,'episodes_reordered',
  jsonb_build_object('revision',s.revision+1,'count',n));
 result:=jsonb_build_object('seriesId',p_series,'revision',s.revision+1,'ordered',n);
 PERFORM marcosa_private.r156_complete_command(p_actor,p_key,result);
 RETURN result;
END;
$body$;

-- No browser role has rights to invoke any private mutations.
REVOKE ALL ON FUNCTION marcosa_private.r156_begin_command(uuid,uuid,text,jsonb),
 marcosa_private.r156_complete_command(uuid,uuid,jsonb),
 marcosa_private.r156_edit_series(uuid,uuid,bigint,text,text,uuid),
 marcosa_private.r156_reorder_episodes(uuid,uuid,bigint,uuid[],uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION marcosa_private.r156_begin_command(uuid,uuid,text,jsonb),
 marcosa_private.r156_complete_command(uuid,uuid,jsonb),
 marcosa_private.r156_edit_series(uuid,uuid,bigint,text,text,uuid),
 marcosa_private.r156_reorder_episodes(uuid,uuid,bigint,uuid[],uuid)
 TO marcosa_r156_writer;
COMMIT;
