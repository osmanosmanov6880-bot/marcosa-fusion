-- MARCOSA R51: private notification preferences for a future production backend.
-- Reference-only isolated PostgreSQL 17 CI. NOT a live Supabase migration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.marcosa_notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 follows_enabled boolean NOT NULL DEFAULT true,
 comments_enabled boolean NOT NULL DEFAULT true,
 sponsorships_enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marcosa_notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marcosa_notification_preferences FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.marcosa_notification_preferences TO authenticated;

-- Read-only browser visibility. The future trusted service must verify the
-- current user, validate only boolean keys, rate-limit writes, and honour
-- preferences while emitting activity events inside the event transaction.
CREATE POLICY marcosa_notification_preferences_owner_select
 ON public.marcosa_notification_preferences FOR SELECT TO authenticated
 USING(user_id=(select auth.uid()));

COMMIT;
