-- MARCOSA R155: PostgreSQL 17 creator/reader contract, isolated reference only.
-- Depends on R30 auth/world/post tables, R41 private block roster and audited
-- R84 interaction_allowed. NEVER apply directly to an existing Supabase project.
-- No direct client mutations. Auth/session/finance migration is NOT implemented.
BEGIN;
CREATE TABLE public.marcosa_seasons(
 id uuid PRIMARY KEY,
 world_id uuid NOT NULL REFERENCES public.marcosa_worlds(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z][a-z0-9-]{2,47}$'),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 100),
 description text NOT NULL DEFAULT '' CHECK(char_length(description)<=600),
 next_at timestamptz,
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marcosa_seasons_owner_idx ON public.marcosa_seasons(owner_id,id DESC);
CREATE TABLE public.marcosa_season_episodes(
 id uuid PRIMARY KEY,
 series_id uuid NOT NULL REFERENCES public.marcosa_seasons(id) ON DELETE CASCADE,
 post_id uuid NOT NULL UNIQUE REFERENCES public.marcosa_posts(id) ON DELETE CASCADE,
 position integer NOT NULL CHECK(position BETWEEN 1 AND 500),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(series_id,position)
);
CREATE INDEX marcosa_episodes_series_idx ON public.marcosa_season_episodes(series_id,position);
CREATE TABLE public.marcosa_season_subscriptions(
 series_id uuid NOT NULL REFERENCES public.marcosa_seasons(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 muted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(series_id,user_id)
);
CREATE TABLE public.marcosa_season_bookmarks(
 episode_id uuid NOT NULL REFERENCES public.marcosa_season_episodes(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(episode_id,user_id)
);
CREATE TABLE public.marcosa_season_attendance(
 episode_id uuid NOT NULL REFERENCES public.marcosa_season_episodes(id) ON DELETE CASCADE,
 viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 first_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(episode_id,viewer_id)
);
CREATE TABLE public.marcosa_season_audit(
 id uuid PRIMARY KEY,
 series_id uuid NOT NULL REFERENCES public.marcosa_seasons(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 action text NOT NULL CHECK(action IN(
  'series_created','series_updated','episode_attached','episode_renamed',
  'episodes_reordered','episode_removed','series_archived','series_restored')),
 details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object' AND length(details::text)<=2048),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marcosa_season_audit_owner_idx ON public.marcosa_season_audit(series_id,created_at DESC,id DESC);

-- Trusted-writer invariant: a series may not claim someone else's world.
CREATE FUNCTION marcosa_private.r155_season_owner_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.marcosa_worlds w
               WHERE w.id=NEW.world_id AND w.owner_id=NEW.owner_id)
 THEN RAISE EXCEPTION 'R155 world/owner mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$guard$;
CREATE TRIGGER r155_season_owner_guard
 BEFORE INSERT OR UPDATE OF owner_id,world_id ON public.marcosa_seasons
 FOR EACH ROW EXECUTE FUNCTION marcosa_private.r155_season_owner_guard();

-- Trusted-writer invariant: an episode must attach a real PUBLISHED post of
-- the season owner in the season world, not a foreign tenant or private draft.
CREATE FUNCTION marcosa_private.r155_episode_post_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $guard$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM public.marcosa_seasons s JOIN public.marcosa_posts p
   ON p.id=NEW.post_id AND p.world_id=s.world_id AND p.author_id=s.owner_id
  WHERE s.id=NEW.series_id AND p.status='published')
 THEN RAISE EXCEPTION 'R155 foreign/draft post not attachable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$guard$;
CREATE TRIGGER r155_episode_post_guard
 BEFORE INSERT OR UPDATE OF post_id,series_id ON public.marcosa_season_episodes
 FOR EACH ROW EXECUTE FUNCTION marcosa_private.r155_episode_post_guard();
REVOKE ALL ON FUNCTION marcosa_private.r155_season_owner_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION marcosa_private.r155_episode_post_guard() FROM PUBLIC,anon,authenticated;

-- Never rely on old default Data API grants; 2026 Supabase requires explicit
-- SELECT grants. ALL client mutations go via a reviewed server endpoint.
ALTER TABLE public.marcosa_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcosa_season_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcosa_season_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcosa_season_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcosa_season_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcosa_season_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marcosa_seasons,public.marcosa_season_episodes,
 public.marcosa_season_subscriptions,public.marcosa_season_bookmarks,
 public.marcosa_season_attendance,public.marcosa_season_audit
 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.marcosa_seasons,public.marcosa_season_episodes TO anon,authenticated;
GRANT SELECT ON public.marcosa_season_subscriptions,public.marcosa_season_bookmarks,
 public.marcosa_season_attendance,public.marcosa_season_audit TO authenticated;

CREATE POLICY marcosa_seasons_guest_read ON public.marcosa_seasons
 FOR SELECT TO anon USING(
  archived_at IS NULL AND EXISTS(SELECT 1 FROM public.marcosa_worlds w
   WHERE w.id=world_id AND w.visibility='public'));
CREATE POLICY marcosa_seasons_user_read ON public.marcosa_seasons
 FOR SELECT TO authenticated USING(
  owner_id=(SELECT auth.uid())
  OR (archived_at IS NULL AND EXISTS(SELECT 1 FROM public.marcosa_worlds w
   WHERE w.id=world_id AND w.visibility='public')
   AND marcosa_authz.interaction_allowed((SELECT auth.uid()),owner_id)));
CREATE POLICY marcosa_episodes_guest_read ON public.marcosa_season_episodes
 FOR SELECT TO anon USING(
  EXISTS(SELECT 1 FROM public.marcosa_seasons s
   JOIN public.marcosa_posts p ON p.id=post_id AND p.status='published'
   WHERE s.id=series_id AND s.archived_at IS NULL
    AND EXISTS(SELECT 1 FROM public.marcosa_worlds w
    WHERE w.id=s.world_id AND w.visibility='public')));
CREATE POLICY marcosa_episodes_user_read ON public.marcosa_season_episodes
 FOR SELECT TO authenticated USING(
  EXISTS(SELECT 1 FROM public.marcosa_seasons s
   JOIN public.marcosa_posts p ON p.id=post_id AND p.status='published'
   WHERE s.id=series_id AND (
    s.owner_id=(SELECT auth.uid()) OR
    (s.archived_at IS NULL AND EXISTS(SELECT 1 FROM public.marcosa_worlds w
      WHERE w.id=s.world_id AND w.visibility='public')
     AND marcosa_authz.interaction_allowed((SELECT auth.uid()),s.owner_id)))));
CREATE POLICY marcosa_subscriptions_self ON public.marcosa_season_subscriptions
 FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY marcosa_bookmarks_self ON public.marcosa_season_bookmarks
 FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY marcosa_attendance_self ON public.marcosa_season_attendance
 FOR SELECT TO authenticated USING(viewer_id=(SELECT auth.uid()));
CREATE POLICY marcosa_season_audit_owner ON public.marcosa_season_audit
 FOR SELECT TO authenticated USING(
  actor_id=(SELECT auth.uid()) AND EXISTS(
   SELECT 1 FROM public.marcosa_seasons s
   WHERE s.id=series_id AND s.owner_id=(SELECT auth.uid())));

COMMENT ON TABLE public.marcosa_seasons IS 'R155 isolated migration reference; not a production deployment.';
COMMENT ON TABLE public.marcosa_season_audit IS 'Private owner-only editorial audit, no client write access.';
COMMIT;
