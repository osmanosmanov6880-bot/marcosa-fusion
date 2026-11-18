-- R157 restored disposable database verification (not a production backup).
\set ON_ERROR_STOP on
DO $$
DECLARE q jsonb;
BEGIN
 IF current_database()<>'marcosa_r157_restored'
 THEN RAISE EXCEPTION 'R157 restore proof forbidden on unexpected database'; END IF;
 IF NOT(SELECT relrowsecurity FROM pg_class
  WHERE oid='marcosa_private.r156_outbox'::regclass)
 THEN RAISE EXCEPTION 'R157 restored private queue RLS missing'; END IF;
 IF has_function_privilege('authenticated',
  'marcosa_private.r157_sweep(integer)','EXECUTE') OR
  has_function_privilege('anon',
  'marcosa_private.r157_delivery_fence(bigint,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'R157 private dispatcher accidentally exposed after restore'; END IF;
 IF (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='dead')<>3 OR
  (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='acked')<>1 OR
  (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='leased')<>0
 THEN RAISE EXCEPTION 'R157 restored dead-letter/ACK states incorrect'; END IF;
 IF (SELECT revision FROM public.marcosa_seasons
  WHERE id='15600000-0000-4156-8156-000000000303')<>2
 THEN RAISE EXCEPTION 'R157 transaction-local edit lost on restore'; END IF;
 IF EXISTS(SELECT 1 FROM marcosa_private.r156_commands WHERE request_key=
  '15700000-0000-4157-8157-000000000442')
 THEN RAISE EXCEPTION 'R157 rolled-back request resurrected after restore'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000002',false);
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_season_attendance)
 OR EXISTS(SELECT 1 FROM public.marcosa_season_bookmarks)
 OR EXISTS(SELECT 1 FROM public.marcosa_season_audit)
 THEN RAISE EXCEPTION 'R157 restoration disclosed withdrawn records or author history'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
SET ROLE marcosa_r156_dispatcher;
DO $$
DECLARE x jsonb;
BEGIN
 x:=marcosa_private.r157_queue_health();
 IF x->>'dead'<>'3' OR x->>'acked'<>'1' OR x->>'pending'<>'0'
 THEN RAISE EXCEPTION 'R157 restored queue statistics invalid: %',x; END IF;
 IF marcosa_private.r157_sweep(10)<>0
 THEN RAISE EXCEPTION 'R157 restored queue recycled already dead jobs'; END IF;
END $$;
RESET ROLE;
SELECT 'R157 restored PG17 private RLS, dead-letter, consent and CAS PASSED' AS proof;
