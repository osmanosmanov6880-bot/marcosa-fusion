-- MARCOSA R37: run after R30 base RLS, R33 identity fixture, and R37 extension.
\set ON_ERROR_STOP on
INSERT INTO public.marcosa_activity_events
 (id,recipient_id,actor_id,kind,world_id) VALUES
 ('c1111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'new_follow','11111111-1111-4111-8111-111111111111'),
 ('c2222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'post_comment','33333333-3333-4333-8333-333333333333');
INSERT INTO public.marcosa_moderation_appeals
 (id,appellant_id,post_id,reason) VALUES
 ('a1111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '88888888-8888-4888-8888-888888888888',
  'This hidden original post deserves an independent review');
INSERT INTO marcosa_private.moderation_audit
 (id,actor_id,post_id,action) VALUES
 ('b1111111-1111-4111-8111-111111111111',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '88888888-8888-4888-8888-888888888888','hide');

DO $$
BEGIN
 IF NOT (
  SELECT bool_and(c.relrowsecurity)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname='public' AND c.relname IN('marcosa_activity_events','marcosa_moderation_appeals'))
     OR (n.nspname='marcosa_private' AND c.relname='moderation_audit')
 ) THEN RAISE EXCEPTION 'R37: missing RLS on extended tables'; END IF;
 IF has_table_privilege('anon','public.marcosa_activity_events','SELECT') OR
    has_table_privilege('anon','public.marcosa_moderation_appeals','SELECT')
 THEN RAISE EXCEPTION 'R37: anon can read private activity/appeals'; END IF;
 IF has_table_privilege('authenticated','public.marcosa_activity_events','INSERT') OR
    has_table_privilege('authenticated','public.marcosa_activity_events','DELETE') OR
    has_table_privilege('authenticated','public.marcosa_moderation_appeals','INSERT') OR
    has_table_privilege('authenticated','public.marcosa_moderation_appeals','DELETE') OR
    has_table_privilege('authenticated','public.marcosa_moderation_appeals','UPDATE') OR
    has_table_privilege('authenticated','marcosa_private.moderation_audit','SELECT')
 THEN RAISE EXCEPTION 'R37: browser can forge or inspect moderation record'; END IF;
 IF has_column_privilege('authenticated','public.marcosa_activity_events','recipient_id','UPDATE') OR
    has_column_privilege('authenticated','public.marcosa_activity_events','actor_id','UPDATE') OR
    has_column_privilege('authenticated','public.marcosa_activity_events','kind','UPDATE')
 THEN RAISE EXCEPTION 'R37: user can rewrite event identity/kind'; END IF;
 IF NOT has_column_privilege('authenticated','public.marcosa_activity_events','read_at','UPDATE')
 THEN RAISE EXCEPTION 'R37: user cannot mark own notifications as read'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $$
DECLARE touched integer;
BEGIN
 IF (SELECT count(*) FROM public.marcosa_activity_events)<>1
 THEN RAISE EXCEPTION 'BOB leaked Alice activity'; END IF;
 IF (SELECT count(*) FROM public.marcosa_moderation_appeals)<>0
 THEN RAISE EXCEPTION 'BOB leaked Alice appeal'; END IF;
 UPDATE public.marcosa_activity_events SET read_at=now()
 WHERE id='c1111111-1111-4111-8111-111111111111';
 GET DIAGNOSTICS touched=ROW_COUNT;
 IF touched<>0 THEN RAISE EXCEPTION 'BOB marked Alice event read'; END IF;
 UPDATE public.marcosa_activity_events SET read_at=now()
 WHERE id='c2222222-2222-4222-8222-222222222222';
 GET DIAGNOSTICS touched=ROW_COUNT;
 IF touched<>1 THEN RAISE EXCEPTION 'BOB cannot mark own event read'; END IF;
 BEGIN
  UPDATE public.marcosa_activity_events SET recipient_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  WHERE id='c1111111-1111-4111-8111-111111111111';
  RAISE EXCEPTION 'BOB could rewrite event recipient';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.marcosa_moderation_appeals
   (appellant_id,post_id,reason)
  VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   '88888888-8888-4888-8888-888888888888',
   'Forge someone else appeal via Data API');
  RAISE EXCEPTION 'BOB inserted unauthorized appeal';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $$
DECLARE touched integer;
BEGIN
 IF (SELECT count(*) FROM public.marcosa_activity_events)<>1
 THEN RAISE EXCEPTION 'ALICE leaked Bob events'; END IF;
 IF (SELECT count(*) FROM public.marcosa_moderation_appeals)<>1
 THEN RAISE EXCEPTION 'ALICE cannot see own appeal'; END IF;
 UPDATE public.marcosa_activity_events SET read_at=now()
 WHERE id='c1111111-1111-4111-8111-111111111111';
 GET DIAGNOSTICS touched=ROW_COUNT;
 IF touched<>1 THEN RAISE EXCEPTION 'ALICE cannot read own event'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_activity_events)<>0
 THEN RAISE EXCEPTION 'CAROL leaked someone else events'; END IF;
 IF (SELECT count(*) FROM public.marcosa_moderation_appeals)<>0
 THEN RAISE EXCEPTION 'CAROL leaked appeals'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_activity_events WHERE read_at IS NOT NULL)<>2
 THEN RAISE EXCEPTION 'R37 read-state mismatch'; END IF;
 IF (SELECT count(*) FROM marcosa_private.moderation_audit)<>1
 THEN RAISE EXCEPTION 'R37 audit record was mutated'; END IF;
 BEGIN
  INSERT INTO public.marcosa_moderation_appeals
   (appellant_id,post_id,reason)
  VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '88888888-8888-4888-8888-888888888888',
   'Duplicate open appeal must be rejected');
  RAISE EXCEPTION 'R37 allowed duplicate open appeal';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;
SELECT 'MARCOSA R37: PostgreSQL private activity and appeals RLS passed' AS proof;
