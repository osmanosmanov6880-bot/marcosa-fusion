-- MARCOSA R156 disposable PG17 - real trusted-writer grants, revision and idempotency.
\set ON_ERROR_STOP on
INSERT INTO auth.users(id) VALUES
 ('15600000-0000-4156-8156-000000000001'),
 ('15600000-0000-4156-8156-000000000002'),
 ('15600000-0000-4156-8156-000000000003'),
 ('15600000-0000-4156-8156-000000000004');
INSERT INTO public.marcosa_profiles(id,handle,display_name) VALUES
 ('15600000-0000-4156-8156-000000000001','r156alice','Alice R156'),
 ('15600000-0000-4156-8156-000000000002','r156bob','Bob R156'),
 ('15600000-0000-4156-8156-000000000003','r156carol','Carol R156'),
 ('15600000-0000-4156-8156-000000000004','r156dave','Dave R156');
INSERT INTO public.marcosa_worlds(id,owner_id,slug,title,visibility) VALUES
 ('15600000-0000-4156-8156-000000000101','15600000-0000-4156-8156-000000000001','alice-r156-world','Alice R156 public','public'),
 ('15600000-0000-4156-8156-000000000102','15600000-0000-4156-8156-000000000004','dave-r156-world','Dave R156 public','public');
INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status) VALUES
 ('15600000-0000-4156-8156-000000000201','15600000-0000-4156-8156-000000000101','15600000-0000-4156-8156-000000000001','R156 post first','published'),
 ('15600000-0000-4156-8156-000000000202','15600000-0000-4156-8156-000000000101','15600000-0000-4156-8156-000000000001','R156 post second','published'),
 ('15600000-0000-4156-8156-000000000203','15600000-0000-4156-8156-000000000101','15600000-0000-4156-8156-000000000001','R156 post third','published'),
 ('15600000-0000-4156-8156-000000000204','15600000-0000-4156-8156-000000000101','15600000-0000-4156-8156-000000000001','R156 post fourth','published'),
 ('15600000-0000-4156-8156-000000000205','15600000-0000-4156-8156-000000000101','15600000-0000-4156-8156-000000000001','R156 draft','draft'),
 ('15600000-0000-4156-8156-000000000206','15600000-0000-4156-8156-000000000102','15600000-0000-4156-8156-000000000004','Dave published','published');
INSERT INTO public.marcosa_seasons(id,world_id,owner_id,slug,title) VALUES
 ('15600000-0000-4156-8156-000000000301','15600000-0000-4156-8156-000000000101','15600000-0000-4156-8156-000000000001','alice-r156-series','R156 original'),
 ('15600000-0000-4156-8156-000000000302','15600000-0000-4156-8156-000000000102','15600000-0000-4156-8156-000000000004','dave-r156-series','Dave original');
INSERT INTO public.marcosa_season_episodes(id,series_id,post_id,position,title) VALUES
 ('15600000-0000-4156-8156-000000000401','15600000-0000-4156-8156-000000000301','15600000-0000-4156-8156-000000000201',1,'One'),
 ('15600000-0000-4156-8156-000000000402','15600000-0000-4156-8156-000000000301','15600000-0000-4156-8156-000000000202',2,'Two');

DO $$
BEGIN
 IF (SELECT rolcanlogin OR rolbypassrls FROM pg_roles WHERE rolname='marcosa_r156_writer')
 THEN RAISE EXCEPTION 'R156 private writer is login-capable or bypasses RLS'; END IF;
 IF (SELECT rolcanlogin OR rolbypassrls FROM pg_roles WHERE rolname='marcosa_r156_dispatcher')
 THEN RAISE EXCEPTION 'R156 dispatcher is login-capable or bypasses RLS'; END IF;
 IF pg_has_role('authenticated','marcosa_r156_writer','MEMBER')
 OR pg_has_role('anon','marcosa_r156_writer','MEMBER')
 OR pg_has_role('authenticated','marcosa_r156_dispatcher','MEMBER')
 THEN RAISE EXCEPTION 'R156 browser inherited a privileged role'; END IF;
 IF has_table_privilege('authenticated','public.marcosa_seasons','UPDATE')
 OR has_table_privilege('authenticated','marcosa_private.r156_outbox','SELECT')
 OR has_function_privilege('authenticated',
   'marcosa_private.r156_edit_series(uuid,uuid,bigint,text,text,uuid)','EXECUTE')
 OR has_function_privilege('anon',
   'marcosa_private.r156_claim(text,integer,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'R156 private server path exposed to browser'; END IF;
 IF NOT(SELECT condeferrable FROM pg_constraint
  WHERE conname='marcosa_season_episodes_series_id_position_key'
   AND conrelid='public.marcosa_season_episodes'::regclass)
 THEN RAISE EXCEPTION 'R156 reorder still has non-deferrable position constraint'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000002',false);
DO $$
BEGIN
 BEGIN
  PERFORM marcosa_private.r156_edit_series(
   '15600000-0000-4156-8156-000000000001',
   '15600000-0000-4156-8156-000000000301',
   0,'Stolen by browser','', '15600000-0000-4156-8156-000000000901');
  RAISE EXCEPTION 'R156 authenticated browser could invoke private writer';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000002',false);
DO $$
BEGIN
 BEGIN
  PERFORM marcosa_private.r156_edit_series(
   '15600000-0000-4156-8156-000000000001',
   '15600000-0000-4156-8156-000000000301',
   0,'Stolen with wrong claim','',
   '15600000-0000-4156-8156-000000000902');
  RAISE EXCEPTION 'R156 caller forged a different verified actor';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM marcosa_private.r156_edit_series(
   '15600000-0000-4156-8156-000000000002',
   '15600000-0000-4156-8156-000000000301',
   0,'Bob attempts to own Alice','',
   '15600000-0000-4156-8156-000000000903');
  RAISE EXCEPTION 'R156 foreign owner was allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000001',false);
DO $$
DECLARE first jsonb; second jsonb; order_result jsonb;
BEGIN
 first:=marcosa_private.r156_edit_series(
  '15600000-0000-4156-8156-000000000001',
  '15600000-0000-4156-8156-000000000301',
  0,'R156 safely edited','version one',
  '15600000-0000-4156-8156-000000000904');
 second:=marcosa_private.r156_edit_series(
  '15600000-0000-4156-8156-000000000001',
  '15600000-0000-4156-8156-000000000301',
  0,'R156 safely edited','version one',
  '15600000-0000-4156-8156-000000000904');
 IF first IS DISTINCT FROM second OR first->>'revision'<>'1'
 THEN RAISE EXCEPTION 'R156 idempotent editor returned conflicting result'; END IF;
 BEGIN
  PERFORM marcosa_private.r156_edit_series(
   '15600000-0000-4156-8156-000000000001',
   '15600000-0000-4156-8156-000000000301',
   0,'Different payload','version one',
   '15600000-0000-4156-8156-000000000904');
  RAISE EXCEPTION 'R156 recycled key changed request';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%key reused%' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM marcosa_private.r156_edit_series(
   '15600000-0000-4156-8156-000000000001',
   '15600000-0000-4156-8156-000000000301',
   0,'Stale revision','version one',
   '15600000-0000-4156-8156-000000000905');
  RAISE EXCEPTION 'R156 stale revision was accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%stale season%' THEN RAISE; END IF;
 END;
 order_result:=marcosa_private.r156_reorder_episodes(
  '15600000-0000-4156-8156-000000000001',
  '15600000-0000-4156-8156-000000000301',1,
  ARRAY['15600000-0000-4156-8156-000000000402'::uuid,
        '15600000-0000-4156-8156-000000000401'::uuid],
  '15600000-0000-4156-8156-000000000906');
 IF order_result->>'revision'<>'2' THEN RAISE EXCEPTION 'R156 reorder revision lost'; END IF;
 IF order_result IS DISTINCT FROM marcosa_private.r156_reorder_episodes(
  '15600000-0000-4156-8156-000000000001',
  '15600000-0000-4156-8156-000000000301',1,
  ARRAY['15600000-0000-4156-8156-000000000402'::uuid,
        '15600000-0000-4156-8156-000000000401'::uuid],
  '15600000-0000-4156-8156-000000000906')
 THEN RAISE EXCEPTION 'R156 duplicate reorder was processed again'; END IF;
 BEGIN
  PERFORM marcosa_private.r156_reorder_episodes(
   '15600000-0000-4156-8156-000000000001',
   '15600000-0000-4156-8156-000000000301',2,
   ARRAY['15600000-0000-4156-8156-000000000401'::uuid,
         '15600000-0000-4156-8156-000000000401'::uuid],
   '15600000-0000-4156-8156-000000000907');
  RAISE EXCEPTION 'R156 duplicate order IDs permitted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%does not match%' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
DO $$
BEGIN
 IF (SELECT revision FROM public.marcosa_seasons WHERE slug='alice-r156-series')<>2
 THEN RAISE EXCEPTION 'R156 edit/reorder mutated revision more than twice'; END IF;
 IF (SELECT position FROM public.marcosa_season_episodes
  WHERE id='15600000-0000-4156-8156-000000000402')<>1
 THEN RAISE EXCEPTION 'R156 order did not persist'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_audit
  WHERE series_id='15600000-0000-4156-8156-000000000301'
   AND action IN ('series_updated','episodes_reordered'))<>2
 THEN RAISE EXCEPTION 'R156 failed commands leaked into editorial journal'; END IF;
 IF (SELECT count(*) FROM marcosa_private.r156_commands
  WHERE actor_id='15600000-0000-4156-8156-000000000001')<>2
 THEN RAISE EXCEPTION 'R156 failed requests left idempotency claims'; END IF;
END $$;
SELECT 'R156 writer isolation + idempotent metadata + safe reorder PASS' AS proof;
