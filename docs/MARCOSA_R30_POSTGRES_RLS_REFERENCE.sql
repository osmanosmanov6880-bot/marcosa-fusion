-- MARCOSA R30: REVIEW-ONLY Postgres/Supabase RLS design.
-- THIS IS NOT AN EXECUTED MIGRATION. No Supabase project is connected.
-- Do not paste into an existing production database without a complete inventory,
-- a backup/restore test, verified Auth users, legal review and 2-identity SQL tests.
--
-- Supabase Oct 2026 breaking-change note: public tables need explicit Data API
-- GRANT; RLS is separate from those grants. Never grant service_role to a client.
-- Security principles: use auth.uid(), both USING and WITH CHECK for updates,
-- no auth.user_metadata decisions or security-definer public functions.
--
-- Apply eventually as a reviewed migration created by Supabase CLI (not this file).

BEGIN;

CREATE TABLE IF NOT EXISTS public.marcosa_profiles(
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  handle text NOT NULL UNIQUE CHECK(handle ~ '^[a-z][a-z0-9_]{2,23}$'),
  display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.marcosa_worlds(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z][a-z0-9-]{2,39}$'),
  title text NOT NULL CHECK(length(title) BETWEEN 3 AND 70),
  description text NOT NULL DEFAULT '' CHECK(length(description) <= 400),
  visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marcosa_worlds_by_owner ON public.marcosa_worlds(owner_id);
CREATE TABLE IF NOT EXISTS public.marcosa_posts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES public.marcosa_worlds(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','hidden')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marcosa_posts_world_status ON public.marcosa_posts(world_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS public.marcosa_world_follows(
  world_id uuid NOT NULL REFERENCES public.marcosa_worlds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(world_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.marcosa_comments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.marcosa_posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 800),
  status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marcosa_comments_post_status ON public.marcosa_comments(post_id,status,created_at DESC);

-- Private sponsor proposals intentionally stay outside the exposed Data API.
CREATE SCHEMA IF NOT EXISTS marcosa_private;
CREATE TABLE IF NOT EXISTS marcosa_private.sponsor_proposals(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  world_id uuid NOT NULL REFERENCES public.marcosa_worlds(id) ON DELETE CASCADE,
  brand_name text NOT NULL CHECK(length(brand_name) BETWEEN 2 AND 75),
  headline text NOT NULL CHECK(length(headline) BETWEEN 5 AND 130),
  landing_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marcosa_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcosa_worlds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcosa_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcosa_world_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcosa_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE marcosa_private.sponsor_proposals ENABLE ROW LEVEL SECURITY;

-- Profiles: public-readable display identity; clients create/update themselves.
CREATE POLICY marcosa_profiles_read ON public.marcosa_profiles
 FOR SELECT TO anon,authenticated USING (true);
CREATE POLICY marcosa_profiles_create ON public.marcosa_profiles
 FOR INSERT TO authenticated WITH CHECK (id=(select auth.uid()));
CREATE POLICY marcosa_profiles_update ON public.marcosa_profiles
 FOR UPDATE TO authenticated
 USING (id=(select auth.uid()))
 WITH CHECK (id=(select auth.uid()));
CREATE POLICY marcosa_profiles_delete ON public.marcosa_profiles
 FOR DELETE TO authenticated USING (id=(select auth.uid()));

-- Worlds: private worlds must not leak to anonymous visitors.
CREATE POLICY marcosa_worlds_read ON public.marcosa_worlds
 FOR SELECT TO anon,authenticated
 USING (visibility='public' OR owner_id=(select auth.uid()));
CREATE POLICY marcosa_worlds_create ON public.marcosa_worlds
 FOR INSERT TO authenticated WITH CHECK (owner_id=(select auth.uid()));
CREATE POLICY marcosa_worlds_update ON public.marcosa_worlds
 FOR UPDATE TO authenticated
 USING (owner_id=(select auth.uid()))
 WITH CHECK (owner_id=(select auth.uid()));
CREATE POLICY marcosa_worlds_delete ON public.marcosa_worlds
 FOR DELETE TO authenticated USING (owner_id=(select auth.uid()));

-- Posts: public only if both post and its parent world are public.
-- Author can read private drafts in owned worlds. Hidden posts remain invisible.
CREATE POLICY marcosa_posts_read ON public.marcosa_posts
 FOR SELECT TO anon,authenticated
 USING (
   (status='published' AND EXISTS (
      SELECT 1 FROM public.marcosa_worlds w WHERE w.id=world_id AND w.visibility='public'
   ))
   OR (author_id=(select auth.uid()) AND status<>'hidden')
 );
CREATE POLICY marcosa_posts_create ON public.marcosa_posts
 FOR INSERT TO authenticated
 WITH CHECK(
   author_id=(select auth.uid())
   AND status IN ('draft','published')
   AND EXISTS (SELECT 1 FROM public.marcosa_worlds w
               WHERE w.id=world_id AND w.owner_id=(select auth.uid()))
 );
CREATE POLICY marcosa_posts_update ON public.marcosa_posts
 FOR UPDATE TO authenticated
 USING (author_id=(select auth.uid()) AND status<>'hidden')
 WITH CHECK(
   author_id=(select auth.uid())
   AND status IN ('draft','published')
   AND EXISTS (SELECT 1 FROM public.marcosa_worlds w
               WHERE w.id=world_id AND w.owner_id=(select auth.uid()))
 );
CREATE POLICY marcosa_posts_delete ON public.marcosa_posts
 FOR DELETE TO authenticated USING (author_id=(select auth.uid()));

-- Membership roster is private; authenticated users can see only THEIR own
-- follows. Aggregate counts must be computed server-side without exposing IDs.
CREATE POLICY marcosa_follows_read_self ON public.marcosa_world_follows
 FOR SELECT TO authenticated USING (user_id=(select auth.uid()));
CREATE POLICY marcosa_follows_create ON public.marcosa_world_follows
 FOR INSERT TO authenticated WITH CHECK(
   user_id=(select auth.uid())
   AND EXISTS(SELECT 1 FROM public.marcosa_worlds w
              WHERE w.id=world_id AND w.visibility='public'
                AND w.owner_id<>(select auth.uid()))
 );
CREATE POLICY marcosa_follows_delete ON public.marcosa_world_follows
 FOR DELETE TO authenticated USING(user_id=(select auth.uid()));

-- Public comments must also belong to genuinely published, public posts.
CREATE POLICY marcosa_comments_read ON public.marcosa_comments
 FOR SELECT TO anon,authenticated
 USING (
   status='published'
   AND EXISTS (SELECT 1 FROM public.marcosa_posts p
               WHERE p.id=post_id AND p.status='published')
 );
CREATE POLICY marcosa_comments_create ON public.marcosa_comments
 FOR INSERT TO authenticated WITH CHECK(
   author_id=(select auth.uid())
   AND status='published'
   AND EXISTS (SELECT 1 FROM public.marcosa_posts p
               WHERE p.id=post_id AND p.status='published')
 );
CREATE POLICY marcosa_comments_delete ON public.marcosa_comments
 FOR DELETE TO authenticated USING (author_id=(select auth.uid()));

-- The private advertising pipeline is NEVER granted directly to the browser.
-- Moderator adjudication should be a server-only transaction with verified
-- backend role, immutable audit trail and separation of duties. No policies on
-- marcosa_private.sponsor_proposals intentionally means default-deny to clients.

-- 2026 Data API explicit grants, in addition to RLS, after project review:
GRANT USAGE ON SCHEMA public TO anon,authenticated;
GRANT SELECT ON public.marcosa_profiles,public.marcosa_worlds,public.marcosa_posts,
 public.marcosa_comments TO anon;
GRANT SELECT ON public.marcosa_profiles,public.marcosa_worlds,public.marcosa_posts,
 public.marcosa_world_follows,public.marcosa_comments TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.marcosa_profiles,public.marcosa_worlds,
 public.marcosa_posts TO authenticated;
GRANT INSERT,DELETE ON public.marcosa_world_follows,public.marcosa_comments TO authenticated;
REVOKE ALL ON marcosa_private.sponsor_proposals FROM PUBLIC,anon,authenticated;

COMMIT;

-- REQUIRED BEFORE ANY REAL APPLICATION:
-- 1. Execute only on newly reviewed schema in isolated project, not blindly
--    on a live database with existing names or grants.
-- 2. Two real JWT users: creator can write own world, stranger cannot; signed-in
--    follower cannot view other people's follow roster; drafts invisible to anon.
-- 3. Mod action route must not use browser-exposed service role/secret key.
-- 4. Validate post UPDATE WITH CHECK prevents re-parenting a world.
-- 5. Check RLS advisor and Data API grants; new Supabase 2026 exposure defaults.
-- 6. Confirm migration rollback/backup and data deletion consistency.
