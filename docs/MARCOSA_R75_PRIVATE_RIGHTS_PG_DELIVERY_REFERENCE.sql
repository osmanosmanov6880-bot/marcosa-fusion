-- MARCOSA R75: private, owner-asserted rights evidence + delivery gate.
-- Disposable PostgreSQL 17 reference only. NOT a live Supabase migration.
-- Never writes storage.objects or a Storage bucket. See R72 for reports.
BEGIN;

CREATE TABLE IF NOT EXISTS marcosa_private.world_cover_rights_claims(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 world_id uuid NOT NULL REFERENCES marcosa_private.world_cover_assets(world_id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 asset_sha256 text NOT NULL CHECK(asset_sha256 ~ '^[a-f0-9]{64}$'),
 statement_version text NOT NULL DEFAULT 'rights-v1' CHECK(statement_version='rights-v1'),
 asserted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marcosa_cover_rights_by_world_digest
 ON marcosa_private.world_cover_rights_claims(world_id,asset_sha256,asserted_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS marcosa_cover_rights_owner_history
 ON marcosa_private.world_cover_rights_claims(owner_id,asserted_at DESC,id DESC);

-- An attestation is a user's statement, not a verified license.
-- A trusted backend must independently authenticate the owner/consent,
-- normalize real media bytes, and insert the statement into this PRIVATE table.
CREATE OR REPLACE FUNCTION marcosa_private.guard_cover_rights_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' AS $$
DECLARE v_asset record;
BEGIN
 IF TG_OP='UPDATE' THEN
  RAISE EXCEPTION 'R75: immutable rights declaration cannot be rewritten';
 END IF;
 SELECT a.uploaded_by,a.sha256,a.normalized,w.owner_id
 INTO v_asset FROM marcosa_private.world_cover_assets a
 JOIN public.marcosa_worlds w ON w.id=a.world_id
 WHERE a.world_id=NEW.world_id FOR SHARE OF a;
 IF v_asset IS NULL OR NEW.owner_id<>v_asset.uploaded_by OR
    NEW.owner_id<>v_asset.owner_id OR NEW.asset_sha256<>v_asset.sha256 OR
    v_asset.normalized IS NOT TRUE OR NEW.statement_version<>'rights-v1'
 THEN RAISE EXCEPTION 'R75: rights assertion must match normalized current owner image digest';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marcosa_private.guard_cover_rights_claim()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS marcosa_guard_cover_rights_claim ON marcosa_private.world_cover_rights_claims;
CREATE TRIGGER marcosa_guard_cover_rights_claim
 BEFORE INSERT OR UPDATE ON marcosa_private.world_cover_rights_claims
 FOR EACH ROW EXECUTE FUNCTION marcosa_private.guard_cover_rights_claim();

ALTER TABLE marcosa_private.world_cover_rights_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marcosa_private.world_cover_rights_claims FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA marcosa_private FROM PUBLIC,anon,authenticated;

-- Fail closed for ALL old/current approved covers lacking an owner claim.
-- Retain the same immutable public eligibility contract columns as R61.
-- This VIEW is private and SECURITY INVOKER; it is not byte-delivery permission.
CREATE OR REPLACE VIEW marcosa_private.world_cover_delivery_ready
 WITH (security_invoker = true, security_barrier = true)
AS
SELECT a.world_id,a.storage_key,a.sha256,a.mime,a.width,a.height,a.byte_size,a.reviewed_at
FROM marcosa_private.world_cover_assets a
JOIN public.marcosa_worlds w ON w.id=a.world_id
JOIN auth.users reviewer ON reviewer.id=a.reviewed_by
WHERE w.visibility='public'
 AND w.owner_id=a.uploaded_by
 AND a.status='approved'
 AND a.normalized IS TRUE
 AND a.reviewed_by<>a.uploaded_by
 AND a.reviewed_at IS NOT NULL
 AND reviewer.raw_app_meta_data @> '{"marcosa_role":"moderator"}'::jsonb
 AND EXISTS(
  SELECT 1 FROM marcosa_private.world_cover_rights_claims att
   WHERE att.world_id=a.world_id
     AND att.owner_id=a.uploaded_by
     AND att.asset_sha256=a.sha256
     AND att.statement_version='rights-v1'
 );
REVOKE ALL ON marcosa_private.world_cover_delivery_ready FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA marcosa_private FROM PUBLIC,anon,authenticated;
COMMENT ON VIEW marcosa_private.world_cover_delivery_ready IS
'R75 restrictive local PG candidate: eligibility additionally needs matching owner image SHA rights claim, plus independent current moderator. It is NOT proof of copyright or permission to fetch Storage bytes; backend must verify viewer block and use private signed delivery.';

COMMIT;
