-- MARCOSA R128: two NEW, intentionally disposable synthetic identities.
-- Seed only AFTER the complete R30-R84 contract has finished mutating its fixtures.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF current_database()<>'postgres'
 THEN RAISE EXCEPTION 'R128 seed refuses non-disposable source'; END IF;
END $$;
INSERT INTO auth.users(id) VALUES
 ('12800000-0000-4128-8128-000000000001'),
 ('12800000-0000-4128-8128-000000000002');
INSERT INTO public.marcosa_profiles(id,handle,display_name) VALUES
 ('12800000-0000-4128-8128-000000000001','r128alice','Restore Fixture Alice'),
 ('12800000-0000-4128-8128-000000000002','r128bob','Restore Fixture Bob');
INSERT INTO public.marcosa_worlds(id,owner_id,slug,title,visibility) VALUES
 ('12800000-0000-4128-8128-000000000101',
  '12800000-0000-4128-8128-000000000001',
  'r128-private','R128 private fixture','private'),
 ('12800000-0000-4128-8128-000000000102',
  '12800000-0000-4128-8128-000000000002',
  'r128-public','R128 public fixture','public');
INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status) VALUES
 ('12800000-0000-4128-8128-000000000201',
  '12800000-0000-4128-8128-000000000101',
  '12800000-0000-4128-8128-000000000001',
  'R128 private restore fixture','published'),
 ('12800000-0000-4128-8128-000000000202',
  '12800000-0000-4128-8128-000000000102',
  '12800000-0000-4128-8128-000000000002',
  'R128 public restore fixture','published');
SELECT 'R128_DISPOSABLE_RESTORE_SEED=PASS' AS result;
