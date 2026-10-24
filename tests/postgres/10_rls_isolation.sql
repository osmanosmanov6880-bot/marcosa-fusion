-- Run only after 00_auth_fixture.sql and R30 reviewed reference schema.
-- Standalone, disposable PostgreSQL database; exercises actual RLS policies.
\set ON_ERROR_STOP on
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
INSERT INTO public.marcosa_profiles(id,handle,display_name) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','alice33','Alice'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bob33','Bob'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','carol33','Carol');
INSERT INTO public.marcosa_worlds(id,owner_id,slug,title,visibility) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','alice-public','Public Alice','public'),
 ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','alice-private','Private Alice','private'),
 ('33333333-3333-4333-8333-333333333333','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bob-public','Public Bob','public');
INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status) VALUES
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Alice public','published'),
 ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Secret draft','draft'),
 ('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Private published','published'),
 ('77777777-7777-4777-8777-777777777777','33333333-3333-4333-8333-333333333333','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Bob public','published'),
 ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Moderation hidden','hidden');
INSERT INTO public.marcosa_comments(id,post_id,author_id,body,status) VALUES
 ('99999999-9999-4999-8999-999999999999','44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Public reply','published'),
 ('00000000-0000-4000-8000-000000000001','66666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Private reply','published'),
 ('00000000-0000-4000-8000-000000000002','77777777-7777-4777-8777-777777777777','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Bob reply','published');
INSERT INTO public.marcosa_world_follows(world_id,user_id) VALUES
 ('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
 ('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
 ('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO marcosa_private.sponsor_proposals(owner_id,world_id,brand_name,headline,landing_url) VALUES
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111',
  'Example Brand','Manual reviewed sponsor only','https://example.org');

-- The browser must never be able to SELECT the private sponsor ledger.
DO $$
BEGIN
 IF has_table_privilege('anon','marcosa_private.sponsor_proposals','SELECT') OR
    has_table_privilege('authenticated','marcosa_private.sponsor_proposals','SELECT')
 THEN RAISE EXCEPTION 'RLS GATE: private sponsor ledger is exposed'; END IF;
 IF has_table_privilege('anon','public.marcosa_world_follows','SELECT')
 THEN RAISE EXCEPTION 'RLS GATE: anonymous follow roster is exposed'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relrowsecurity AND
      ((n.nspname='public' AND c.relname LIKE 'marcosa_%') OR
       (n.nspname='marcosa_private' AND c.relname='sponsor_proposals'))) <> 6
 THEN RAISE EXCEPTION 'RLS GATE: not all six base tables have RLS'; END IF;
END $$;

SET ROLE anon;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_worlds)<>2
 THEN RAISE EXCEPTION 'ANON sees a private world'; END IF;
 IF (SELECT count(*) FROM public.marcosa_posts)<>2
 THEN RAISE EXCEPTION 'ANON sees a private/draft/hidden post'; END IF;
 IF (SELECT count(*) FROM public.marcosa_comments)<>2
 THEN RAISE EXCEPTION 'ANON sees a private comment'; END IF;
END $$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $$
DECLARE changed integer;
BEGIN
 IF (SELECT count(*) FROM public.marcosa_worlds)<>2
 THEN RAISE EXCEPTION 'BOB sees Alice private World'; END IF;
 IF (SELECT count(*) FROM public.marcosa_posts)<>2
 THEN RAISE EXCEPTION 'BOB sees draft/private/hidden post'; END IF;
 IF (SELECT count(*) FROM public.marcosa_world_follows)<>1
 THEN RAISE EXCEPTION 'BOB sees another users follow roster'; END IF;
 UPDATE public.marcosa_posts SET body='unauthorized change'
 WHERE id='44444444-4444-4444-8444-444444444444';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>0 THEN RAISE EXCEPTION 'BOB edited Alice post'; END IF;
 UPDATE public.marcosa_worlds SET owner_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 WHERE id='11111111-1111-4111-8111-111111111111';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>0 THEN RAISE EXCEPTION 'BOB stole Alice World'; END IF;
 BEGIN
  INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status)
  VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111',
         'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Unauthorized','published');
  RAISE EXCEPTION 'BOB inserted into Alice World';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.marcosa_world_follows(world_id,user_id)
  VALUES('33333333-3333-4333-8333-333333333333','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  RAISE EXCEPTION 'BOB followed own World';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
-- Bob's valid published post in Bob's World remains editable only by Bob.
INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status)
VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','33333333-3333-4333-8333-333333333333',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Own post','published');
DO $$
BEGIN
 BEGIN
  UPDATE public.marcosa_posts SET world_id='11111111-1111-4111-8111-111111111111'
  WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  RAISE EXCEPTION 'BOB reparented a post into Alice World';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_worlds)<>3
 THEN RAISE EXCEPTION 'ALICE cannot read own private World'; END IF;
 IF (SELECT count(*) FROM public.marcosa_posts)<>5
 THEN RAISE EXCEPTION 'ALICE cannot read own draft/private post or sees hidden post'; END IF;
 IF (SELECT count(*) FROM public.marcosa_posts WHERE id='88888888-8888-4888-8888-888888888888')<>0
 THEN RAISE EXCEPTION 'Hidden content became readable'; END IF;
 IF (SELECT count(*) FROM public.marcosa_world_follows)<>1
 THEN RAISE EXCEPTION 'ALICE sees another users follow roster'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_world_follows)<>1
 THEN RAISE EXCEPTION 'CAROL sees another users follow roster'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

DO $$
BEGIN
 IF (SELECT world_id FROM public.marcosa_posts WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')
    <>'33333333-3333-4333-8333-333333333333'::uuid
 THEN RAISE EXCEPTION 'Post was reparented despite WITH CHECK'; END IF;
END $$;
SELECT 'MARCOSA R33: PostgreSQL 17 RLS isolation checks passed' AS proof;
