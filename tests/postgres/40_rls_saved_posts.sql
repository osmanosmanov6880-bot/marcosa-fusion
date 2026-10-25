-- MARCOSA R43: real PostgreSQL 17 assertions, independent from the SQLite lab.
\set ON_ERROR_STOP on
INSERT INTO public.marcosa_saved_posts(user_id,post_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','77777777-7777-4777-8777-777777777777'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444');

DO $$
BEGIN
 IF NOT(SELECT relrowsecurity FROM pg_class
   WHERE oid='public.marcosa_saved_posts'::regclass)
 THEN RAISE EXCEPTION 'R43: personal saves are missing RLS'; END IF;
 IF has_table_privilege('anon','public.marcosa_saved_posts','SELECT')
 THEN RAISE EXCEPTION 'R43: saved post list exposed to anonymous viewers'; END IF;
 IF NOT has_table_privilege('authenticated','public.marcosa_saved_posts','SELECT')
 THEN RAISE EXCEPTION 'R43: owner is unable to read own saved references'; END IF;
 IF has_table_privilege('authenticated','public.marcosa_saved_posts','INSERT')
  OR has_table_privilege('authenticated','public.marcosa_saved_posts','DELETE')
  OR has_table_privilege('authenticated','public.marcosa_saved_posts','UPDATE')
 THEN RAISE EXCEPTION 'R43: client can mutate saves outside trusted server'; END IF;
 IF (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='marcosa_saved_posts')<>1
 THEN RAISE EXCEPTION 'R43: unexpected policies on personal saves'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_saved_posts)<>1
 THEN RAISE EXCEPTION 'R43: Alice can inspect other user saves'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.marcosa_saved_posts
  WHERE post_id='77777777-7777-4777-8777-777777777777')
 THEN RAISE EXCEPTION 'R43: Alice cannot read own saved post'; END IF;
 BEGIN
  INSERT INTO public.marcosa_saved_posts(user_id,post_id) VALUES
   ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444');
  RAISE EXCEPTION 'R43: Alice was able to bypass trusted bookmark writer';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  DELETE FROM public.marcosa_saved_posts
   WHERE user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  RAISE EXCEPTION 'R43: Alice was able to bypass trusted bookmark delete';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_saved_posts)<>1
 THEN RAISE EXCEPTION 'R43: Bob can inspect Alice saves'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.marcosa_saved_posts
 WHERE post_id='44444444-4444-4444-8444-444444444444')
 THEN RAISE EXCEPTION 'R43: Bob cannot read his own saved post'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_saved_posts)<>0
 THEN RAISE EXCEPTION 'R43: Carol can inspect other users bookmarks'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE anon;
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM public.marcosa_saved_posts;
  RAISE EXCEPTION 'R43: anon SELECT unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_saved_posts)<>2
 THEN RAISE EXCEPTION 'R43: forbidden user operations modified bookmarks'; END IF;
 BEGIN
  INSERT INTO public.marcosa_saved_posts(user_id,post_id) VALUES
   ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','77777777-7777-4777-8777-777777777777');
  RAISE EXCEPTION 'R43: duplicate bookmark accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO public.marcosa_saved_posts(user_id,post_id) VALUES
   ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ffffffff-ffff-4fff-8fff-ffffffffffff');
  RAISE EXCEPTION 'R43: saved reference to missing post accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
END $$;

DELETE FROM public.marcosa_posts
 WHERE id='77777777-7777-4777-8777-777777777777';
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.marcosa_saved_posts
  WHERE post_id='77777777-7777-4777-8777-777777777777')
 THEN RAISE EXCEPTION 'R43: deleting original post did not clean up saves'; END IF;
 IF (SELECT count(*) FROM public.marcosa_saved_posts)<>1
 THEN RAISE EXCEPTION 'R43: deletion harmed unrelated bookmarks'; END IF;
END $$;
SELECT 'MARCOSA R43: private saved-posts RLS and deletion integrity passed' AS proof;
