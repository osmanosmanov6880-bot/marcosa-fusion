-- R61: revocable private media delivery eligibility, real PostgreSQL 17 only.
-- Uses disposable Postgres; no Supabase Auth/Storage project touched.
\set ON_ERROR_STOP on

-- Local auth.users fixture models only the trusted app_metadata distinction.
-- Actual Supabase auth.users already has these two fields.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO public.marcosa_worlds(id,owner_id,slug,title,visibility)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '11111111-2222-4333-8444-555555555555','r61-public-world','R61 gated World','public');

INSERT INTO marcosa_private.world_cover_assets(
 world_id,uploaded_by,storage_key,sha256,mime,width,height,byte_size,
 normalized,status,reviewed_by,reviewed_at
) VALUES(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-2222-4333-8444-555555555555',
 'world-covers/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/'||repeat('d',64)||'.png',
 repeat('d',64),'image/png',1280,720,100234,
 true,'approved','33333333-4444-4555-8666-777777777777',now()
);

-- Forged self-editable user metadata must never authorize media.
UPDATE auth.users SET raw_user_meta_data='{"marcosa_role":"moderator"}'::jsonb
 WHERE id='33333333-4444-4555-8666-777777777777';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_delivery_ready)
 THEN RAISE EXCEPTION 'R61: editable user_metadata authorized a cover'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c
  WHERE c.oid='marcosa_private.world_cover_delivery_ready'::regclass
  AND 'security_invoker=true'=ANY(c.reloptions))
 THEN RAISE EXCEPTION 'R61: delivery view bypasses caller permissions'; END IF;
 IF has_schema_privilege('anon','marcosa_private','USAGE')
    OR has_schema_privilege('authenticated','marcosa_private','USAGE')
    OR has_table_privilege('anon','marcosa_private.world_cover_delivery_ready','SELECT')
    OR has_table_privilege('authenticated','marcosa_private.world_cover_delivery_ready','SELECT')
 THEN RAISE EXCEPTION 'R61: browser can query private storage keys'; END IF;
END $$;

-- A trusted change to app_metadata activates approval.
UPDATE auth.users SET raw_app_meta_data='{"marcosa_role":"moderator"}'::jsonb
 WHERE id='33333333-4444-4555-8666-777777777777';
DO $$
BEGIN
 IF (SELECT count(*) FROM marcosa_private.world_cover_delivery_ready)<>1
 THEN RAISE EXCEPTION 'R61: approved verified public cover hidden'; END IF;
END $$;

-- Viewer eligibility depends on current World privacy.
UPDATE public.marcosa_worlds SET visibility='private'
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_delivery_ready)
 THEN RAISE EXCEPTION 'R61: private World delivered a public object key'; END IF;
END $$;
UPDATE public.marcosa_worlds SET visibility='public'
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- Reopening, replacement, quarantine or reviewer demotion fail closed.
UPDATE marcosa_private.world_cover_assets SET status='quarantined'
 WHERE world_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_delivery_ready)
 THEN RAISE EXCEPTION 'R61: quarantined media eligible'; END IF;
END $$;
UPDATE marcosa_private.world_cover_assets SET status='approved'
 WHERE world_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

UPDATE auth.users SET raw_app_meta_data='{}'::jsonb
 WHERE id='33333333-4444-4555-8666-777777777777';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_delivery_ready)
 THEN RAISE EXCEPTION 'R61: demoted reviewer retained publication authority'; END IF;
END $$;
UPDATE auth.users SET raw_app_meta_data='{"marcosa_role":"moderator"}'::jsonb
 WHERE id='33333333-4444-4555-8666-777777777777';

SET ROLE anon;
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.world_cover_delivery_ready;
  RAISE EXCEPTION 'R61: anonymous client saw private storage location';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-2222-4333-8444-555555555555',false);
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM marcosa_private.world_cover_delivery_ready;
  RAISE EXCEPTION 'R61: owner bypassed trusted media delivery gateway';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

DELETE FROM public.marcosa_worlds
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM marcosa_private.world_cover_delivery_ready)
 THEN RAISE EXCEPTION 'R61: orphan delivery key survived world deletion'; END IF;
END $$;
SELECT 'MARCOSA R61 revocable media delivery readiness PostgreSQL PASS' AS proof;
