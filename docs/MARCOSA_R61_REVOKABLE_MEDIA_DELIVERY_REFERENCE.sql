-- MARCOSA R61: trusted read model for *potential* public cover delivery.
-- Review-only PostgreSQL 17 contract. NOT a live Supabase migration.
-- No storage.objects modifications; NEVER expose original quarantine object URLs.
-- Only a trusted backend may read this PRIVATE schema after checking privileges.
BEGIN;

CREATE OR REPLACE VIEW marcosa_private.world_cover_delivery_ready
 WITH (security_invoker = true, security_barrier = true)
AS
SELECT a.world_id, a.storage_key, a.sha256, a.mime,
       a.width, a.height, a.byte_size, a.reviewed_at
FROM marcosa_private.world_cover_assets a
JOIN public.marcosa_worlds w ON w.id=a.world_id
JOIN auth.users reviewer ON reviewer.id=a.reviewed_by
WHERE w.visibility='public'
 AND w.owner_id=a.uploaded_by
 AND a.status='approved'
 AND a.normalized IS TRUE
 AND a.reviewed_by<>a.uploaded_by
 AND a.reviewed_at IS NOT NULL
 -- Trusted Supabase Auth app metadata, never user-editable user_metadata/JWT claims.
 AND reviewer.raw_app_meta_data @> '{"marcosa_role":"moderator"}'::jsonb;

REVOKE ALL ON marcosa_private.world_cover_delivery_ready FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA marcosa_private FROM PUBLIC,anon,authenticated;

COMMENT ON VIEW marcosa_private.world_cover_delivery_ready IS
'R61 private eligibility gate only, not permission to fetch bytes; trusted server must verify Storage private bucket, current block/access constraints, safe contents, signed delivery TTL and abuse policy.';
COMMIT;
