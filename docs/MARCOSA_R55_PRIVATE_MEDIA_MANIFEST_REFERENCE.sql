-- MARCOSA R55: reference metadata, NOT a Supabase Storage migration.
-- Storage schema and bucket object bytes MUST be managed through the Storage
-- API, never by modifying storage.objects in SQL.
BEGIN;

CREATE TABLE IF NOT EXISTS marcosa_private.world_cover_assets(
 world_id uuid PRIMARY KEY REFERENCES public.marcosa_worlds(id) ON DELETE CASCADE,
 uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 storage_key text NOT NULL UNIQUE
  CHECK(storage_key ~ '^world-covers/[a-f0-9-]{36}/[a-f0-9]{64}\.png$'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 mime text NOT NULL DEFAULT 'image/png' CHECK(mime='image/png'),
 width int NOT NULL CHECK(width BETWEEN 1 AND 1600),
 height int NOT NULL CHECK(height BETWEEN 1 AND 1600),
 byte_size int NOT NULL CHECK(byte_size BETWEEN 57 AND 786432),
 normalized boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending','approved','quarantined','removed')),
 reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 reviewed_at timestamptz,
 uploaded_at timestamptz NOT NULL DEFAULT now(),
 CHECK(width::bigint*height::bigint<=1500000),
 CHECK(status<>'approved' OR (normalized=true AND reviewed_by IS NOT NULL
   AND reviewed_at IS NOT NULL AND reviewed_by<>uploaded_by))
);
CREATE INDEX IF NOT EXISTS marcosa_cover_by_status
 ON marcosa_private.world_cover_assets(status,uploaded_at DESC);

-- SECURITY INVOKER, fully qualified source names, and private schema.
-- The trusted service must also enforce limits and inspect actual file
-- bytes before writing this manifest. Browser JWT is never trusted to do so.
CREATE OR REPLACE FUNCTION marcosa_private.guard_world_cover_manifest()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.marcosa_worlds w
     WHERE w.id=NEW.world_id AND w.owner_id=NEW.uploaded_by)
 THEN RAISE EXCEPTION 'World cover uploader must be its actual owner';
 END IF;
 IF split_part(NEW.storage_key,'/',2)<>NEW.world_id::text
    OR split_part(NEW.storage_key,'/',3)<>NEW.sha256||'.png'
 THEN RAISE EXCEPTION 'World cover key must match world UUID and digest';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION marcosa_private.guard_world_cover_manifest()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS marcosa_guard_cover_manifest ON marcosa_private.world_cover_assets;
CREATE TRIGGER marcosa_guard_cover_manifest
 BEFORE INSERT OR UPDATE ON marcosa_private.world_cover_assets
 FOR EACH ROW EXECUTE FUNCTION marcosa_private.guard_world_cover_manifest();

ALTER TABLE marcosa_private.world_cover_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marcosa_private.world_cover_assets FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA marcosa_private FROM PUBLIC,anon,authenticated;

COMMIT;
