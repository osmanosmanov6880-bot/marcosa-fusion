-- MARCOSA R72: independently reviewed reports on ALREADY APPROVED covers.
-- Review-only for disposable PostgreSQL 17; never applied to any live Supabase.
-- Storage buckets / storage.objects are NOT modified by this contract.
-- All writes require a trusted backend that verifies its staff session.
BEGIN;

CREATE TABLE IF NOT EXISTS marcosa_private.world_cover_reports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 world_id uuid NOT NULL REFERENCES marcosa_private.world_cover_assets(world_id) ON DELETE CASCADE,
 reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 asset_sha256 text NOT NULL CHECK(asset_sha256 ~ '^[a-f0-9]{64}$'),
 original_reviewer uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 reason text NOT NULL CHECK(reason IN ('copyright','privacy','abuse','impersonation','other')),
 detail text NOT NULL CHECK(length(btrim(detail)) BETWEEN 12 AND 500),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','upheld','dismissed','withdrawn')),
 decided_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 UNIQUE(world_id,reporter_id,asset_sha256),
 CONSTRAINT marcosa_cover_report_status_transition CHECK(
  (status='open' AND decided_by IS NULL AND decided_at IS NULL)
  OR (status='withdrawn' AND decided_by IS NULL AND decided_at IS NOT NULL)
  OR (status IN ('upheld','dismissed') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
 ),
 CONSTRAINT marcosa_cover_report_independent CHECK(
  decided_by IS NULL OR (decided_by<>reporter_id AND decided_by<>original_reviewer)
 )
);
CREATE INDEX IF NOT EXISTS marcosa_cover_reports_pending_age
 ON marcosa_private.world_cover_reports(created_at ASC,id) WHERE status='open';
CREATE INDEX IF NOT EXISTS marcosa_cover_reports_owner_world
 ON marcosa_private.world_cover_reports(world_id,status,created_at DESC);

-- IMPORTANT: an allowed report never by itself makes media public or hidden.
-- Trusted backend handles report intake from already-authenticated users.
-- Only an independently authenticated, currently authorized moderator may
-- adjudicate a report; the database rechecks the role immediately at UPDATE.
CREATE OR REPLACE FUNCTION marcosa_private.guard_cover_report()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' AS $$
DECLARE
 asset record;
 owner_uuid uuid;
 original_reviewer_role boolean;
 resolver_role boolean;
BEGIN
 SELECT a.world_id,a.uploaded_by,a.sha256,a.status,a.normalized,
        a.reviewed_by,a.reviewed_at,w.owner_id,w.visibility
 INTO asset
 FROM marcosa_private.world_cover_assets a
 JOIN public.marcosa_worlds w ON w.id=a.world_id
 WHERE a.world_id=NEW.world_id FOR UPDATE OF a;
 IF asset IS NULL THEN RAISE EXCEPTION 'R72: reported cover does not exist'; END IF;
 owner_uuid:=asset.owner_id;

 IF TG_OP='INSERT' THEN
  IF NEW.reporter_id=owner_uuid OR
     NEW.asset_sha256<>asset.sha256 OR asset.status<>'approved' OR
     asset.normalized IS NOT TRUE OR asset.visibility<>'public' OR
     asset.reviewed_by IS NULL OR asset.reviewed_at IS NULL
  THEN RAISE EXCEPTION 'R72: report must target another owner current published cover'; END IF;
  SELECT (u.raw_app_meta_data @> '{"marcosa_role":"moderator"}'::jsonb)
    INTO original_reviewer_role FROM auth.users u WHERE u.id=asset.reviewed_by;
  IF COALESCE(original_reviewer_role,false) IS NOT TRUE
  THEN RAISE EXCEPTION 'R72: prior reviewer no longer authorized'; END IF;
  IF EXISTS(SELECT 1 FROM public.marcosa_user_blocks b
    WHERE (b.blocker_id=NEW.reporter_id AND b.blocked_id=owner_uuid)
       OR (b.blocker_id=owner_uuid AND b.blocked_id=NEW.reporter_id))
  THEN RAISE EXCEPTION 'R72: blocked viewer cannot submit a report'; END IF;
  IF NEW.status<>'open' OR NEW.decided_by IS NOT NULL OR
     NEW.decided_at IS NOT NULL
  THEN RAISE EXCEPTION 'R72: report must begin open and undecided'; END IF;
  NEW.original_reviewer:=asset.reviewed_by; -- never taken from user payload
 ELSIF TG_OP='UPDATE' THEN
  IF OLD.status<>'open' OR NEW.status='open' OR
     OLD.id<>NEW.id OR OLD.world_id<>NEW.world_id OR
     OLD.reporter_id<>NEW.reporter_id OR OLD.asset_sha256<>NEW.asset_sha256 OR
     OLD.original_reviewer<>NEW.original_reviewer OR OLD.reason<>NEW.reason OR
     OLD.detail<>NEW.detail OR OLD.created_at<>NEW.created_at
  THEN RAISE EXCEPTION 'R72: report history is immutable; decisions are single-use'; END IF;
  IF NEW.status='withdrawn' THEN
   IF NEW.decided_by IS NOT NULL OR NEW.decided_at IS NULL
   THEN RAISE EXCEPTION 'R72: invalid withdrawn status'; END IF;
   RETURN NEW; -- stale reports are closed privately after a takedown/replacement
  END IF;
  IF NEW.status NOT IN ('upheld','dismissed') OR NEW.decided_by IS NULL
     OR NEW.decided_at IS NULL
  THEN RAISE EXCEPTION 'R72: invalid independent reviewer decision'; END IF;
  IF NEW.decided_by=owner_uuid OR NEW.decided_by=NEW.reporter_id OR
     NEW.decided_by=NEW.original_reviewer
  THEN RAISE EXCEPTION 'R72: author, reporter or original reviewer cannot adjudicate'; END IF;
  SELECT (u.raw_app_meta_data @> '{"marcosa_role":"moderator"}'::jsonb)
   INTO resolver_role FROM auth.users u WHERE u.id=NEW.decided_by;
  IF COALESCE(resolver_role,false) IS NOT TRUE
  THEN RAISE EXCEPTION 'R72: deciding staff moderator role was revoked'; END IF;
  IF asset.sha256<>NEW.asset_sha256 OR asset.status<>'approved'
     OR asset.normalized IS NOT TRUE OR asset.visibility<>'public'
     OR asset.reviewed_by IS DISTINCT FROM NEW.original_reviewer
  THEN RAISE EXCEPTION 'R72: stale image/digest or non-public asset cannot be decided'; END IF;

  IF NEW.status='upheld' THEN
   -- Same transaction as report UPDATE: immediately withdraw public-media eligibility.
   UPDATE marcosa_private.world_cover_assets
    SET status='quarantined',reviewed_by=NEW.decided_by,reviewed_at=NEW.decided_at
    WHERE world_id=NEW.world_id AND sha256=NEW.asset_sha256 AND status='approved';
   IF NOT FOUND THEN RAISE EXCEPTION 'R72: atomic cover revocation failed'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marcosa_private.guard_cover_report()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS marcosa_guard_cover_report ON marcosa_private.world_cover_reports;
CREATE TRIGGER marcosa_guard_cover_report BEFORE INSERT OR UPDATE
 ON marcosa_private.world_cover_reports FOR EACH ROW
 EXECUTE FUNCTION marcosa_private.guard_cover_report();

CREATE OR REPLACE FUNCTION marcosa_private.close_cover_reports_after_takedown()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' AS $$
BEGIN
 IF OLD.status='open' AND NEW.status='upheld' THEN
  UPDATE marcosa_private.world_cover_reports
   SET status='withdrawn',decided_at=NEW.decided_at
   WHERE world_id=NEW.world_id AND id<>NEW.id AND status='open';
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION marcosa_private.close_cover_reports_after_takedown()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS marcosa_close_reports_after_takedown ON marcosa_private.world_cover_reports;
CREATE TRIGGER marcosa_close_reports_after_takedown
 AFTER UPDATE ON marcosa_private.world_cover_reports
 FOR EACH ROW EXECUTE FUNCTION marcosa_private.close_cover_reports_after_takedown();

ALTER TABLE marcosa_private.world_cover_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marcosa_private.world_cover_reports FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA marcosa_private FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE marcosa_private.world_cover_reports IS
'R72 reference-only private reports: trusted service must authenticate submission/moderators, audit, notify and manage private Storage; no browser Data API access';
COMMIT;
