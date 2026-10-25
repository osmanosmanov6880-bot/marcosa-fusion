-- R41: run after disposable 00 fixture, R30 and R37 policies and tests.
\set ON_ERROR_STOP on
INSERT INTO public.marcosa_user_blocks(blocker_id,blocked_id,created_at) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-10-25T00:00:00Z'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','2026-10-25T00:00:00Z');

DO $$
DECLARE enabled boolean;
BEGIN
 SELECT c.relrowsecurity INTO enabled FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='marcosa_user_blocks';
 IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'R41 RLS missing'; END IF;
 IF has_table_privilege('anon','public.marcosa_user_blocks','SELECT')
 THEN RAISE EXCEPTION 'Anonymous can read block rosters'; END IF;
 IF NOT has_table_privilege('authenticated','public.marcosa_user_blocks','SELECT')
 THEN RAISE EXCEPTION 'Owner cannot read own block roster'; END IF;
 IF has_table_privilege('authenticated','public.marcosa_user_blocks','INSERT') OR
    has_table_privilege('authenticated','public.marcosa_user_blocks','UPDATE') OR
    has_table_privilege('authenticated','public.marcosa_user_blocks','DELETE')
 THEN RAISE EXCEPTION 'Browser can forge or revoke blocks outside atomic server transaction'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='marcosa_user_blocks')<>1
 THEN RAISE EXCEPTION 'Unexpected block policy footprint'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.marcosa_user_blocks;
 IF n<>1 THEN RAISE EXCEPTION 'Alice leaked another user block list'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.marcosa_user_blocks
                 WHERE blocked_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
 THEN RAISE EXCEPTION 'Alice missing her own block'; END IF;
 IF EXISTS (SELECT 1 FROM public.marcosa_user_blocks
             WHERE blocker_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
 THEN RAISE EXCEPTION 'Alice sees Bob confidential blocked accounts'; END IF;
 BEGIN
  INSERT INTO public.marcosa_user_blocks(blocker_id,blocked_id)
  VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  RAISE EXCEPTION 'Client forged a block';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  DELETE FROM public.marcosa_user_blocks
  WHERE blocker_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  RAISE EXCEPTION 'Client deleted a block without server cleanup';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_user_blocks)<>1
 THEN RAISE EXCEPTION 'Bob sees Alice confidential blocks'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.marcosa_user_blocks
                WHERE blocked_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')
 THEN RAISE EXCEPTION 'Bob missing his own blocked Carol entry'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_user_blocks)<>0
 THEN RAISE EXCEPTION 'Carol sees another user block roster'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE anon;
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM public.marcosa_user_blocks;
  RAISE EXCEPTION 'Anonymous SELECT unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_user_blocks)<>2
 THEN RAISE EXCEPTION 'R41 client operations changed block relations'; END IF;
 BEGIN
  INSERT INTO public.marcosa_user_blocks(blocker_id,blocked_id)
  VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
         'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  RAISE EXCEPTION 'R41 allowed self-block';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO public.marcosa_user_blocks(blocker_id,blocked_id)
  VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  RAISE EXCEPTION 'R41 allowed duplicate block';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;
SELECT 'MARCOSA R41: PostgreSQL blocked-user RLS isolation passed' AS proof;
