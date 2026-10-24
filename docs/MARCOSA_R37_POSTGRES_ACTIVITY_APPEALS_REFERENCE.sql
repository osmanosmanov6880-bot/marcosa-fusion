-- MARCOSA R37: ADDITIVE, REVIEW-ONLY PostgreSQL/Supabase contract for R31-R32.
-- Not a production migration. Run only against an isolated verified Postgres
-- after R30 reference; never execute blindly against existing user tables.
-- Security model: private activity is owner-only; actual event creation, moderation,
-- sponsor decisions and appeals adjudication remain trusted BACKEND transactions.
-- Browser roles NEVER insert events or moderation/audit decisions.
BEGIN;

CREATE TABLE IF NOT EXISTS public.marcosa_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN
   ('new_follow','post_comment','sponsor_proposal','sponsor_accepted',
    'sponsor_rejected','sponsor_approved','sponsor_revoked')),
  world_id uuid REFERENCES public.marcosa_worlds(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.marcosa_posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT marcosa_activity_not_self CHECK(recipient_id<>actor_id)
);
CREATE INDEX IF NOT EXISTS marcosa_activity_recipient_recent
 ON public.marcosa_activity_events(recipient_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS marcosa_activity_unread
 ON public.marcosa_activity_events(recipient_id,id DESC) WHERE read_at IS NULL;
ALTER TABLE public.marcosa_activity_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.marcosa_activity_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.marcosa_activity_events TO authenticated;
-- Column-scoped update: clients may mark their OWN events read, not rewrite
-- recipient_id, actor_id, kind, timestamps or the source object.
GRANT UPDATE(read_at) ON public.marcosa_activity_events TO authenticated;
CREATE POLICY marcosa_activity_read_self ON public.marcosa_activity_events
 FOR SELECT TO authenticated USING(recipient_id=(select auth.uid()));
CREATE POLICY marcosa_activity_mark_read_self ON public.marcosa_activity_events
 FOR UPDATE TO authenticated
 USING(recipient_id=(select auth.uid()))
 WITH CHECK(recipient_id=(select auth.uid()));

CREATE TABLE IF NOT EXISTS public.marcosa_moderation_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appellant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.marcosa_posts(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.marcosa_comments(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 1000),
  status text NOT NULL DEFAULT 'open'
   CHECK(status IN ('open','upheld','restored')),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT marcosa_appeal_exactly_one_subject CHECK(
   (post_id IS NOT NULL AND comment_id IS NULL)
   OR (post_id IS NULL AND comment_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS marcosa_appeal_open_post
 ON public.marcosa_moderation_appeals(post_id)
 WHERE post_id IS NOT NULL AND status='open';
CREATE UNIQUE INDEX IF NOT EXISTS marcosa_appeal_open_comment
 ON public.marcosa_moderation_appeals(comment_id)
 WHERE comment_id IS NOT NULL AND status='open';
CREATE INDEX IF NOT EXISTS marcosa_appeal_owner_recent
 ON public.marcosa_moderation_appeals(appellant_id,created_at DESC,id DESC);
ALTER TABLE public.marcosa_moderation_appeals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marcosa_moderation_appeals FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.marcosa_moderation_appeals TO authenticated;
CREATE POLICY marcosa_appeal_read_self ON public.marcosa_moderation_appeals
 FOR SELECT TO authenticated USING(appellant_id=(select auth.uid()));
-- No INSERT/UPDATE/DELETE policy for Data API users.
-- Verified backend must check object ownership/hidden status and do transactional
-- appeal creation and resolution; moderator roles are NEVER derived from user_metadata.

CREATE TABLE IF NOT EXISTS marcosa_private.moderation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  post_id uuid REFERENCES public.marcosa_posts(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.marcosa_comments(id) ON DELETE CASCADE,
  appeal_id uuid REFERENCES public.marcosa_moderation_appeals(id) ON DELETE SET NULL,
  action text NOT NULL CHECK(action IN ('hide','upheld','restored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marcosa_moderation_subject CHECK(
   (post_id IS NOT NULL AND comment_id IS NULL)
   OR (post_id IS NULL AND comment_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS marcosa_moderation_audit_post
 ON marcosa_private.moderation_audit(post_id,created_at DESC);
CREATE INDEX IF NOT EXISTS marcosa_moderation_audit_comment
 ON marcosa_private.moderation_audit(comment_id,created_at DESC);
ALTER TABLE marcosa_private.moderation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marcosa_private.moderation_audit FROM PUBLIC,anon,authenticated;
-- Default-deny: no browser policy. Backend must keep this schema unexposed.

COMMIT;
