-- MARCOSA R43 - executable PostgreSQL/Supabase reference for personal saves.
-- Apply only in disposable CI AFTER the reviewed R30 and R37 references.
-- NEVER treat this as a live Supabase migration or expose private saves as
-- aggregate marketing data.
BEGIN;

CREATE TABLE IF NOT EXISTS public.marcosa_saved_posts (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 post_id uuid NOT NULL REFERENCES public.marcosa_posts(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,post_id)
);
CREATE INDEX IF NOT EXISTS marcosa_saved_posts_owner_recent
 ON public.marcosa_saved_posts(user_id,created_at DESC,post_id DESC);

ALTER TABLE public.marcosa_saved_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marcosa_saved_posts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.marcosa_saved_posts TO authenticated;

-- Owner-only metadata. Full post text must always pass the parent post's
-- independent RLS policy and the backend bilateral user-block filter.
-- INSERT/DELETE remain trusted backend operations because the backend
-- verifies published source and block relation before modifying saved_posts.
CREATE POLICY marcosa_saved_posts_read_self
 ON public.marcosa_saved_posts FOR SELECT TO authenticated
 USING(user_id=(select auth.uid()));
COMMIT;
