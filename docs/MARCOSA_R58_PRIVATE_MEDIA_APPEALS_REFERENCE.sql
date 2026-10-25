-- MARCOSA R58: private, independently adjudicated World-cover appeals.
-- ONLY disposable PostgreSQL 17 CI: NOT applied to a live Supabase project.
-- All uploads/byte processing use a trusted service and Storage API.
BEGIN;
CREATE TABLE IF NOT EXISTS marcosa_private.world_cover_appeals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 world_id uuid NOT NULL REFERENCES marcosa_private.world_cover_assets(world_id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 asset_sha256 text NOT NULL CHECK(asset_sha256 ~ '^[a-f0-9]{64}$'),
 original_reviewer uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 12 AND 1000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','upheld','reopened','withdrawn')),
 reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,
 CONSTRAINT marcosa_cover_appeal_decision_state CHECK(
   (status='open' AND reviewed_by IS NULL AND decided_at IS NULL)
   OR (status='withdrawn' AND reviewed_by IS NULL AND decided_at IS NOT NULL)
   OR (status IN ('upheld','reopened') AND reviewed_by IS NOT NULL AND decided_at IS NOT NULL)
 ),
 CONSTRAINT marcosa_cover_appeal_independent_reviewer CHECK(
   reviewed_by IS NULL OR
   (reviewed_by<>owner_id AND
      (original_reviewer IS NULL OR reviewed_by<>original_reviewer))
 )
);
CREATE UNIQUE INDEX IF NOT EXISTS marcosa_cover_appeals_one_open
 ON marcosa_private.world_cover_appeals(world_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS marcosa_cover_appeals_owner_recent
 ON marcosa_private.world_cover_appeals(owner_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS marcosa_cover_appeals_review_queue
 ON marcosa_private.world_cover_appeals(status,created_at ASC);

CREATE OR REPLACE FUNCTION marcosa_private.guard_cover_appeal()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' AS $$
DECLARE v_asset record;
BEGIN
 SELECT a.uploaded_by,a.sha256,a.status,a.reviewed_by
 INTO v_asset FROM marcosa_private.world_cover_assets a WHERE a.world_id=NEW.world_id;
 IF TG_OP='INSERT' THEN
  IF v_asset IS NULL OR v_asset.uploaded_by<>NEW.owner_id OR
     v_asset.sha256<>NEW.asset_sha256 OR v_asset.status<>'quarantined'
  THEN RAISE EXCEPTION 'Appeal must target the owner current quarantined asset';
  END IF;
  IF NEW.status<>'open' OR NEW.reviewed_by IS NOT NULL OR NEW.decided_at IS NOT NULL
  THEN RAISE EXCEPTION 'New cover appeal must be open and unreviewed'; END IF;
  -- The rejecting moderator is captured by the trusted database, not by
  -- user-controlled client payload or editable JWT metadata.
  NEW.original_reviewer:=v_asset.reviewed_by;
 ELSIF TG_OP='UPDATE' THEN
  IF OLD.status<>'open' OR OLD.world_id<>NEW.world_id OR
    OLD.owner_id<>NEW.owner_id OR OLD.asset_sha256<>NEW.asset_sha256 OR
    OLD.original_reviewer IS DISTINCT FROM NEW.original_reviewer OR
    OLD.reason<>NEW.reason OR OLD.created_at<>NEW.created_at
  THEN RAISE EXCEPTION 'Cover appeal provenance and decisions are immutable'; END IF;
  IF NEW.status='open' THEN RAISE EXCEPTION 'An open appeal cannot be silently rewritten'; END IF;
  IF NEW.status IN ('upheld','reopened') AND
   (v_asset IS NULL OR v_asset.sha256<>NEW.asset_sha256
    OR v_asset.status<>'quarantined')
  THEN RAISE EXCEPTION 'Stale appeal cannot change moderation outcome'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marcosa_private.guard_cover_appeal()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS marcosa_guard_cover_appeal ON marcosa_private.world_cover_appeals;
CREATE TRIGGER marcosa_guard_cover_appeal BEFORE INSERT OR UPDATE
 ON marcosa_private.world_cover_appeals
 FOR EACH ROW EXECUTE FUNCTION marcosa_private.guard_cover_appeal();
ALTER TABLE marcosa_private.world_cover_appeals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marcosa_private.world_cover_appeals FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA marcosa_private FROM PUBLIC,anon,authenticated;
COMMIT;
