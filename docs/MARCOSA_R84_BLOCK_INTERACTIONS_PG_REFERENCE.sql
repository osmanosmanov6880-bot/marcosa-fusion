-- MARCOSA R84: PostgreSQL 17 reciprocal block safety.
-- Additive to R30+R41 reference SQL. Disposable CI ONLY, not an applied
-- migration, not real Supabase Auth, not a production Data API endpoint.
-- No client writes directly to block roster; trusted backend must verify
-- real session/auth before changing blocks.
BEGIN;

-- Deliberately NOT a Data API exposed schema. Narrow schema USAGE allows
-- execution in authenticated RLS policies; does NOT grant any table data.
CREATE SCHEMA IF NOT EXISTS marcosa_authz;
REVOKE ALL ON SCHEMA marcosa_authz FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION marcosa_authz.interaction_allowed(actor uuid,target uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
 SELECT actor IS NOT NULL AND target IS NOT NULL
  AND actor=(SELECT auth.uid())
  AND NOT EXISTS(
    SELECT 1 FROM public.marcosa_user_blocks b
    WHERE (b.blocker_id=actor AND b.blocked_id=target)
       OR (b.blocker_id=target AND b.blocked_id=actor)
  );
$function$;
REVOKE ALL ON FUNCTION marcosa_authz.interaction_allowed(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA marcosa_authz TO authenticated;
GRANT EXECUTE ON FUNCTION marcosa_authz.interaction_allowed(uuid,uuid)
 TO authenticated;
COMMENT ON FUNCTION marcosa_authz.interaction_allowed(uuid,uuid) IS
'R84: only checks auth.uid() as actor and reciprocal block state; schema must NOT be exposed via Supabase Data API. This leaks only the action-eligibility bit to the actor.';

-- RLS alone can see the caller's OWN outgoing blocked roster, but not an
-- INCOMING block. A narrow, definer-owned eligibility check avoids bypass
-- of a remote user's private roster without returning their block list.
DROP POLICY IF EXISTS marcosa_follows_create ON public.marcosa_world_follows;
CREATE POLICY marcosa_follows_create ON public.marcosa_world_follows
 FOR INSERT TO authenticated WITH CHECK(
  user_id=(SELECT auth.uid())
  AND EXISTS(
   SELECT 1 FROM public.marcosa_worlds w
   WHERE w.id=world_id AND w.visibility='public'
    AND w.owner_id<>(SELECT auth.uid())
    AND marcosa_authz.interaction_allowed(user_id,w.owner_id)
  )
 );

DROP POLICY IF EXISTS marcosa_comments_create ON public.marcosa_comments;
CREATE POLICY marcosa_comments_create ON public.marcosa_comments
 FOR INSERT TO authenticated WITH CHECK(
   author_id=(SELECT auth.uid())
   AND status='published'
   AND EXISTS(
    SELECT 1 FROM public.marcosa_posts p
    JOIN public.marcosa_worlds w ON w.id=p.world_id
    WHERE p.id=marcosa_comments.post_id AND p.status='published'
      AND w.visibility='public'
      -- Explicitly qualify the OUTER inserted comment author. Using bare
      -- "author_id" would resolve to p.author_id and break cross-user replies.
      AND marcosa_authz.interaction_allowed(marcosa_comments.author_id,w.owner_id)
   )
 );

-- The creator of a block is a trusted server operation (browser cannot
-- INSERT in marcosa_user_blocks). Its database trigger atomically revokes
-- follow relations in both directions; public publication is unaffected.
CREATE OR REPLACE FUNCTION marcosa_authz.revoke_follows_for_block()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
 DELETE FROM public.marcosa_world_follows f
 USING public.marcosa_worlds w
 WHERE f.world_id=w.id
 AND ((w.owner_id=NEW.blocker_id AND f.user_id=NEW.blocked_id)
   OR (w.owner_id=NEW.blocked_id AND f.user_id=NEW.blocker_id));
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION marcosa_authz.revoke_follows_for_block()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS marcosa_revoke_follows_on_block ON public.marcosa_user_blocks;
CREATE TRIGGER marcosa_revoke_follows_on_block
 AFTER INSERT ON public.marcosa_user_blocks
 FOR EACH ROW EXECUTE FUNCTION marcosa_authz.revoke_follows_for_block();

-- Any PRE-existing reciprocal blocked follows must be reconciled on
-- installation too; enabling the trigger alone would not clean old rows.
DELETE FROM public.marcosa_world_follows f
USING public.marcosa_worlds w,public.marcosa_user_blocks b
WHERE f.world_id=w.id
 AND ((w.owner_id=b.blocker_id AND f.user_id=b.blocked_id)
   OR (w.owner_id=b.blocked_id AND f.user_id=b.blocker_id));

-- All R30 original global guest read policy rules remain unchanged.
-- The pairwise helper is not a signed media link or a complete feed filter.
COMMIT;
