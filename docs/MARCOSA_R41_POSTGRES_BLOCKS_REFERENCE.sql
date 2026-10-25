-- MARCOSA R41: reference-only Postgres/Supabase access model.
-- ADDITIVE to reviewed R30 and R37 contracts, NOT an executed production
-- migration. A verified backend must implement atomic unblock/block effects:
-- follows, unread activity and sponsor consent are NOT automatically revoked
-- by this table or RLS policy alone.
BEGIN;

CREATE TABLE IF NOT EXISTS public.marcosa_user_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id,blocked_id),
  CONSTRAINT marcosa_no_self_block CHECK (blocker_id<>blocked_id)
);
CREATE INDEX IF NOT EXISTS marcosa_user_blocks_target
 ON public.marcosa_user_blocks(blocked_id,blocker_id);
CREATE INDEX IF NOT EXISTS marcosa_user_blocks_newest
 ON public.marcosa_user_blocks(blocker_id,created_at DESC);

ALTER TABLE public.marcosa_user_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marcosa_user_blocks FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.marcosa_user_blocks TO authenticated;

-- Data API callers may see their own block roster only; no client-side
-- insert/update/delete to avoid bypassing atomic follow/ads/activity revocation.
CREATE POLICY marcosa_blocks_read_self ON public.marcosa_user_blocks
 FOR SELECT TO authenticated USING (blocker_id=(select auth.uid()));

COMMIT;
