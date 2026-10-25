-- R51: executable PostgreSQL 17 privacy contract after R30..R46.
\set ON_ERROR_STOP on
INSERT INTO auth.users(id) VALUES
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff');

INSERT INTO public.marcosa_notification_preferences(user_id) VALUES
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff');
INSERT INTO public.marcosa_notification_preferences
 (user_id,follows_enabled,comments_enabled,sponsorships_enabled)
 VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false,true,false);

DO $$
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.marcosa_notification_preferences'::regclass)
 THEN RAISE EXCEPTION 'R51: RLS missing'; END IF;
 IF has_table_privilege('anon','public.marcosa_notification_preferences','SELECT')
 THEN RAISE EXCEPTION 'R51: anonymous can read notification settings'; END IF;
 IF NOT has_table_privilege('authenticated','public.marcosa_notification_preferences','SELECT')
 THEN RAISE EXCEPTION 'R51: authenticated owner cannot read preferences'; END IF;
 IF has_table_privilege('authenticated','public.marcosa_notification_preferences','INSERT')
  OR has_table_privilege('authenticated','public.marcosa_notification_preferences','UPDATE')
  OR has_table_privilege('authenticated','public.marcosa_notification_preferences','DELETE')
 THEN RAISE EXCEPTION 'R51: client bypasses trusted notification consent writer'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='marcosa_notification_preferences')<>1
 THEN RAISE EXCEPTION 'R51: unexpected open policy'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false);
DO $$
DECLARE v record;
BEGIN
 IF (SELECT count(*) FROM public.marcosa_notification_preferences)<>1
 THEN RAISE EXCEPTION 'R51: user D sees other user settings'; END IF;
 SELECT * INTO v FROM public.marcosa_notification_preferences LIMIT 1;
 IF v.user_id<>'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid OR NOT v.follows_enabled
  OR NOT v.comments_enabled OR NOT v.sponsorships_enabled
 THEN RAISE EXCEPTION 'R51: new owner defaults incorrect'; END IF;
 BEGIN
  UPDATE public.marcosa_notification_preferences SET follows_enabled=false
  WHERE user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  RAISE EXCEPTION 'R51: browser changed preferences without backend consent validation';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  DELETE FROM public.marcosa_notification_preferences
  WHERE user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  RAISE EXCEPTION 'R51: browser removed preferences';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
DO $$
DECLARE v record;
BEGIN
 IF (SELECT count(*) FROM public.marcosa_notification_preferences)<>1
 THEN RAISE EXCEPTION 'R51: E can read another users settings'; END IF;
 SELECT * INTO v FROM public.marcosa_notification_preferences LIMIT 1;
 IF v.user_id<>'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
 OR v.follows_enabled OR NOT v.comments_enabled OR v.sponsorships_enabled
 THEN RAISE EXCEPTION 'R51: E preferences corrupted or overwritten'; END IF;
 BEGIN
  INSERT INTO public.marcosa_notification_preferences(user_id)
   VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  RAISE EXCEPTION 'R51: E inserted preferences for another owner';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM public.marcosa_notification_preferences)<>1
 THEN RAISE EXCEPTION 'R51: F can read D or E preferences'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE anon;
DO $$
BEGIN
 BEGIN
  PERFORM count(*) FROM public.marcosa_notification_preferences;
  RAISE EXCEPTION 'R51: anon read restricted preferences';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

-- Trusted backend test: a boolean update is permitted when made by a fully
-- privileged server and does not alter another owner. This is NOT a browser grant.
UPDATE public.marcosa_notification_preferences
 SET follows_enabled=false,updated_at=now()
 WHERE user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
DO $$
BEGIN
 IF (SELECT follows_enabled FROM public.marcosa_notification_preferences
 WHERE user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')<>false
 THEN RAISE EXCEPTION 'R51: backend write missing'; END IF;
 IF NOT (SELECT follows_enabled FROM public.marcosa_notification_preferences
 WHERE user_id='ffffffff-ffff-4fff-8fff-ffffffffffff')
 THEN RAISE EXCEPTION 'R51: backend update leaked across accounts'; END IF;
END $$;

DELETE FROM auth.users WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_notification_preferences
 WHERE user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')
 THEN RAISE EXCEPTION 'R51: account deletion failed to remove private settings'; END IF;
 IF (SELECT count(*) FROM public.marcosa_notification_preferences)<>2
 THEN RAISE EXCEPTION 'R51: cascading delete affected unrelated account preferences'; END IF;
END $$;
SELECT 'MARCOSA R51: owner-only notification settings PostgreSQL RLS PASS' AS proof;
