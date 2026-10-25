-- R84 disposable PostgreSQL 17: true client role + policy acceptance.
-- Run after R75 and its tests. These IDs exist ONLY inside CI fixture.
\set ON_ERROR_STOP on

DO $$ BEGIN
 IF has_schema_privilege('anon','marcosa_authz','USAGE')
  OR has_function_privilege('anon','marcosa_authz.interaction_allowed(uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','marcosa_authz.interaction_allowed(uuid,uuid)','EXECUTE')
  OR has_function_privilege('authenticated','marcosa_authz.revoke_follows_for_block()','EXECUTE')
  OR has_table_privilege('authenticated','public.marcosa_user_blocks','INSERT')
 THEN RAISE EXCEPTION 'R84: unsafe authz permission to guest/client'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger
    WHERE tgname='marcosa_revoke_follows_on_block' AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'R84: missing trusted follow revocation trigger'; END IF;
 -- Existing Alice -> Bob private block from R41 must reconcile old follows.
 IF EXISTS(SELECT 1 FROM public.marcosa_world_follows f
  JOIN public.marcosa_worlds w ON w.id=f.world_id
  JOIN public.marcosa_user_blocks b
   ON ((w.owner_id=b.blocker_id AND f.user_id=b.blocked_id)
     OR (w.owner_id=b.blocked_id AND f.user_id=b.blocker_id)))
 THEN RAISE EXCEPTION 'R84: preexisting blocked follow edges were not revoked'; END IF;
END $$;

INSERT INTO auth.users(id,raw_app_meta_data,raw_user_meta_data) VALUES
('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','{}','{"marcosa_role":"moderator"}'),
('ffffffff-ffff-4fff-8fff-ffffffffffff','{}','{"marcosa_role":"moderator"}');
INSERT INTO public.marcosa_profiles(id,handle,display_name) VALUES
('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','r84emily','Emily'),
('ffffffff-ffff-4fff-8fff-ffffffffffff','r84frank','Frank');
INSERT INTO public.marcosa_worlds(id,owner_id,slug,title) VALUES
('19191919-1919-4919-8919-191919191919','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','r84-emily-world','Emily public'),
('29292929-2929-4929-8929-292929292929','ffffffff-ffff-4fff-8fff-ffffffffffff','r84-frank-world','Frank public');
INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status) VALUES
('39393939-3939-4939-8939-393939393939','19191919-1919-4919-8919-191919191919','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Emily original post','published'),
('49494949-4949-4949-8949-494949494949','29292929-2929-4929-8929-292929292929','ffffffff-ffff-4fff-8fff-ffffffffffff','Frank original post','published');
-- Exercise actual authenticated INSERT policy while no block yet.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
DO $$ BEGIN
 IF NOT marcosa_authz.interaction_allowed(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'ffffffff-ffff-4fff-8fff-ffffffffffff')
 THEN RAISE EXCEPTION 'R84: valid interaction rejected before block'; END IF;
 IF marcosa_authz.interaction_allowed(
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'ffffffff-ffff-4fff-8fff-ffffffffffff')
 THEN RAISE EXCEPTION 'R84: forged actor UID passed authz helper'; END IF;
END $$;
INSERT INTO public.marcosa_world_follows(world_id,user_id)
VALUES('29292929-2929-4929-8929-292929292929','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
INSERT INTO public.marcosa_comments(id,post_id,author_id,body)
VALUES('59595959-5959-4959-8959-595959595959',
 '49494949-4949-4949-8949-494949494949',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Valid comment before block');
RESET ROLE;
RESET request.jwt.claim.sub;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',false);
INSERT INTO public.marcosa_world_follows(world_id,user_id)
VALUES('19191919-1919-4919-8919-191919191919','ffffffff-ffff-4fff-8fff-ffffffffffff');
RESET ROLE;
RESET request.jwt.claim.sub;

DO $$ BEGIN
 IF (SELECT count(*) FROM public.marcosa_world_follows
  WHERE user_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                   'ffffffff-ffff-4fff-8fff-ffffffffffff'))<>2
 THEN RAISE EXCEPTION 'R84: setup lacked genuine reciprocal follows'; END IF;
END $$;

-- The actual trusted server insert creates one directional private block,
-- but its database trigger revokes both directions IN THE SAME transaction.
INSERT INTO public.marcosa_user_blocks(blocker_id,blocked_id)
VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
       'ffffffff-ffff-4fff-8fff-ffffffffffff');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_world_follows
  WHERE user_id IN ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                   'ffffffff-ffff-4fff-8fff-ffffffffffff')
  AND world_id IN ('19191919-1919-4919-8919-191919191919',
                   '29292929-2929-4929-8929-292929292929'))
 THEN RAISE EXCEPTION 'R84: reciprocal follows remained after block'; END IF;
END $$;

-- Actor can see the decision for themselves, not another private block roster.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
DO $$ BEGIN
 IF marcosa_authz.interaction_allowed(
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'ffffffff-ffff-4fff-8fff-ffffffffffff')
 THEN RAISE EXCEPTION 'R84: blocker allowed to interact with target'; END IF;
 IF (SELECT count(*) FROM public.marcosa_user_blocks WHERE blocker_id=
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')<>1
 THEN RAISE EXCEPTION 'R84: block owner has lost own private roster'; END IF;
 BEGIN
  INSERT INTO public.marcosa_world_follows(world_id,user_id)
   VALUES('29292929-2929-4929-8929-292929292929',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  RAISE EXCEPTION 'R84: blocked actor restored a forbidden follow';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.marcosa_comments(post_id,author_id,body)
   VALUES('49494949-4949-4949-8949-494949494949',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Forbidden block comment');
  RAISE EXCEPTION 'R84: blocker inserted comment despite block';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 -- The blocker must remain able to publish their own content.
END $$;
INSERT INTO public.marcosa_comments(post_id,author_id,body)
VALUES('39393939-3939-4939-8939-393939393939',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Self-owned content still allowed');
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',false);
DO $$ BEGIN
 IF marcosa_authz.interaction_allowed(
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
 THEN RAISE EXCEPTION 'R84: INCOMING private block was ignored'; END IF;
 IF (SELECT count(*) FROM public.marcosa_user_blocks)<>0
 THEN RAISE EXCEPTION 'R84: blocked user saw another person private block list'; END IF;
 BEGIN
  INSERT INTO public.marcosa_world_follows(world_id,user_id)
   VALUES('19191919-1919-4919-8919-191919191919',
    'ffffffff-ffff-4fff-8fff-ffffffffffff');
  RAISE EXCEPTION 'R84: blocked user restored forbidden follow';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.marcosa_comments(post_id,author_id,body)
   VALUES('39393939-3939-4939-8939-393939393939',
    'ffffffff-ffff-4fff-8fff-ffffffffffff','Forbidden inverse comment');
  RAISE EXCEPTION 'R84: blocked user inserted comment despite incoming block';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 -- Changing user_metadata to a fake moderation role never bypasses block.
 IF marcosa_authz.interaction_allowed(
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
 THEN RAISE EXCEPTION 'R84: editable user_metadata bypassed private block'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM marcosa_authz.interaction_allowed(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'ffffffff-ffff-4fff-8fff-ffffffffffff');
  RAISE EXCEPTION 'R84: anonymous caller ran private authz helper';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

-- Block references have FK-cascade semantics; trusted deletion is not an
-- excuse for clients to delete someone else's relations directly.
DELETE FROM auth.users WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_user_blocks
  WHERE blocker_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
   OR blocked_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
 THEN RAISE EXCEPTION 'R84: deleted account retains blocked edge'; END IF;
END $$;
SELECT 'MARCOSA R84 reciprocal PostgreSQL block RLS and atomic follow revocation PASS' AS proof;
