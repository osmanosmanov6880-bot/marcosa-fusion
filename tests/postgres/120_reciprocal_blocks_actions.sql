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
('0123ab45-1234-4bcd-8eef-00000000a184','{}','{"marcosa_role":"moderator"}'),
('0123ab46-1234-4bcd-8eef-00000000b184','{}','{"marcosa_role":"moderator"}');
INSERT INTO public.marcosa_profiles(id,handle,display_name) VALUES
('0123ab45-1234-4bcd-8eef-00000000a184','r84emily','Emily'),
('0123ab46-1234-4bcd-8eef-00000000b184','r84frank','Frank');
INSERT INTO public.marcosa_worlds(id,owner_id,slug,title) VALUES
('19191919-1919-4919-8919-191919191919','0123ab45-1234-4bcd-8eef-00000000a184','r84-emily-world','Emily public'),
('29292929-2929-4929-8929-292929292929','0123ab46-1234-4bcd-8eef-00000000b184','r84-frank-world','Frank public');
INSERT INTO public.marcosa_posts(id,world_id,author_id,body,status) VALUES
('39393939-3939-4939-8939-393939393939','19191919-1919-4919-8919-191919191919','0123ab45-1234-4bcd-8eef-00000000a184','Emily original post','published'),
('49494949-4949-4949-8949-494949494949','29292929-2929-4929-8929-292929292929','0123ab46-1234-4bcd-8eef-00000000b184','Frank original post','published');
-- Exercise actual authenticated INSERT policy while no block yet.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','0123ab45-1234-4bcd-8eef-00000000a184',false);
DO $$ BEGIN
 IF NOT marcosa_authz.interaction_allowed(
  '0123ab45-1234-4bcd-8eef-00000000a184',
  '0123ab46-1234-4bcd-8eef-00000000b184')
 THEN RAISE EXCEPTION 'R84: valid interaction rejected before block'; END IF;
 IF marcosa_authz.interaction_allowed(
  '0123ab46-1234-4bcd-8eef-00000000b184',
  '0123ab46-1234-4bcd-8eef-00000000b184')
 THEN RAISE EXCEPTION 'R84: forged actor UID passed authz helper'; END IF;
END $$;
INSERT INTO public.marcosa_world_follows(world_id,user_id)
VALUES('29292929-2929-4929-8929-292929292929','0123ab45-1234-4bcd-8eef-00000000a184');
INSERT INTO public.marcosa_comments(id,post_id,author_id,body)
VALUES('59595959-5959-4959-8959-595959595959',
 '49494949-4949-4949-8949-494949494949',
 '0123ab45-1234-4bcd-8eef-00000000a184','Valid comment before block');
RESET ROLE;
RESET request.jwt.claim.sub;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','0123ab46-1234-4bcd-8eef-00000000b184',false);
INSERT INTO public.marcosa_world_follows(world_id,user_id)
VALUES('19191919-1919-4919-8919-191919191919','0123ab46-1234-4bcd-8eef-00000000b184');
RESET ROLE;
RESET request.jwt.claim.sub;

DO $$ BEGIN
 IF (SELECT count(*) FROM public.marcosa_world_follows
  WHERE user_id IN ('0123ab45-1234-4bcd-8eef-00000000a184',
                   '0123ab46-1234-4bcd-8eef-00000000b184'))<>2
 THEN RAISE EXCEPTION 'R84: setup lacked genuine reciprocal follows'; END IF;
END $$;

-- The actual trusted server insert creates one directional private block,
-- but its database trigger revokes both directions IN THE SAME transaction.
INSERT INTO public.marcosa_user_blocks(blocker_id,blocked_id)
VALUES('0123ab45-1234-4bcd-8eef-00000000a184',
       '0123ab46-1234-4bcd-8eef-00000000b184');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_world_follows
  WHERE user_id IN ('0123ab45-1234-4bcd-8eef-00000000a184',
                   '0123ab46-1234-4bcd-8eef-00000000b184')
  AND world_id IN ('19191919-1919-4919-8919-191919191919',
                   '29292929-2929-4929-8929-292929292929'))
 THEN RAISE EXCEPTION 'R84: reciprocal follows remained after block'; END IF;
END $$;

-- Actor can see the decision for themselves, not another private block roster.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','0123ab45-1234-4bcd-8eef-00000000a184',false);
DO $$ BEGIN
 IF marcosa_authz.interaction_allowed(
   '0123ab45-1234-4bcd-8eef-00000000a184',
   '0123ab46-1234-4bcd-8eef-00000000b184')
 THEN RAISE EXCEPTION 'R84: blocker allowed to interact with target'; END IF;
 IF (SELECT count(*) FROM public.marcosa_user_blocks WHERE blocker_id=
   '0123ab45-1234-4bcd-8eef-00000000a184')<>1
 THEN RAISE EXCEPTION 'R84: block owner has lost own private roster'; END IF;
 BEGIN
  INSERT INTO public.marcosa_world_follows(world_id,user_id)
   VALUES('29292929-2929-4929-8929-292929292929',
    '0123ab45-1234-4bcd-8eef-00000000a184');
  RAISE EXCEPTION 'R84: blocked actor restored a forbidden follow';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.marcosa_comments(post_id,author_id,body)
   VALUES('49494949-4949-4949-8949-494949494949',
    '0123ab45-1234-4bcd-8eef-00000000a184','Forbidden block comment');
  RAISE EXCEPTION 'R84: blocker inserted comment despite block';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 -- The blocker must remain able to publish their own content.
END $$;
INSERT INTO public.marcosa_comments(post_id,author_id,body)
VALUES('39393939-3939-4939-8939-393939393939',
 '0123ab45-1234-4bcd-8eef-00000000a184','Self-owned content still allowed');
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','0123ab46-1234-4bcd-8eef-00000000b184',false);
DO $$ BEGIN
 IF marcosa_authz.interaction_allowed(
  '0123ab46-1234-4bcd-8eef-00000000b184',
  '0123ab45-1234-4bcd-8eef-00000000a184')
 THEN RAISE EXCEPTION 'R84: INCOMING private block was ignored'; END IF;
 IF (SELECT count(*) FROM public.marcosa_user_blocks)<>0
 THEN RAISE EXCEPTION 'R84: blocked user saw another person private block list'; END IF;
 BEGIN
  INSERT INTO public.marcosa_world_follows(world_id,user_id)
   VALUES('19191919-1919-4919-8919-191919191919',
    '0123ab46-1234-4bcd-8eef-00000000b184');
  RAISE EXCEPTION 'R84: blocked user restored forbidden follow';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.marcosa_comments(post_id,author_id,body)
   VALUES('39393939-3939-4939-8939-393939393939',
    '0123ab46-1234-4bcd-8eef-00000000b184','Forbidden inverse comment');
  RAISE EXCEPTION 'R84: blocked user inserted comment despite incoming block';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 -- Changing user_metadata to a fake moderation role never bypasses block.
 IF marcosa_authz.interaction_allowed(
  '0123ab46-1234-4bcd-8eef-00000000b184',
  '0123ab45-1234-4bcd-8eef-00000000a184')
 THEN RAISE EXCEPTION 'R84: editable user_metadata bypassed private block'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM marcosa_authz.interaction_allowed(
    '0123ab45-1234-4bcd-8eef-00000000a184',
    '0123ab46-1234-4bcd-8eef-00000000b184');
  RAISE EXCEPTION 'R84: anonymous caller ran private authz helper';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

-- Block references have FK-cascade semantics; trusted deletion is not an
-- excuse for clients to delete someone else's relations directly.
DELETE FROM auth.users WHERE id='0123ab45-1234-4bcd-8eef-00000000a184';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_user_blocks
  WHERE blocker_id='0123ab45-1234-4bcd-8eef-00000000a184'
   OR blocked_id='0123ab45-1234-4bcd-8eef-00000000a184')
 THEN RAISE EXCEPTION 'R84: deleted account retains blocked edge'; END IF;
END $$;
SELECT 'MARCOSA R84 reciprocal PostgreSQL block RLS and atomic follow revocation PASS' AS proof;
