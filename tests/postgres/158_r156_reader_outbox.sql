-- R156 real PostgreSQL 17: reader consent, revocation, private outbox & fencing.
\set ON_ERROR_STOP on
SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000002',false);
DO $$
DECLARE joined jsonb;
BEGIN
 joined:=marcosa_private.r156_subscription(
  '15600000-0000-4156-8156-000000000002',
  '15600000-0000-4156-8156-000000000301','join',
  '15600000-0000-4156-8156-000000000910');
 IF joined->>'subscribed'<>'true' THEN RAISE EXCEPTION 'R156 subscribe failed'; END IF;
 IF joined IS DISTINCT FROM marcosa_private.r156_subscription(
  '15600000-0000-4156-8156-000000000002',
  '15600000-0000-4156-8156-000000000301','join',
  '15600000-0000-4156-8156-000000000910')
 THEN RAISE EXCEPTION 'R156 idempotent join changed result'; END IF;
 IF (marcosa_private.r156_bookmark(
  '15600000-0000-4156-8156-000000000002',
  '15600000-0000-4156-8156-000000000401',true,
  '15600000-0000-4156-8156-000000000911')->>'saved')<>'true'
 THEN RAISE EXCEPTION 'R156 reader cannot save a published episode'; END IF;
 IF (marcosa_private.r156_attendance(
  '15600000-0000-4156-8156-000000000002',
  '15600000-0000-4156-8156-000000000401',true,
  '15600000-0000-4156-8156-000000000912')->>'present')<>'true'
 THEN RAISE EXCEPTION 'R156 voluntary attendance not recorded'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000003',false);
DO $$
BEGIN
 PERFORM marcosa_private.r156_subscription(
  '15600000-0000-4156-8156-000000000003',
  '15600000-0000-4156-8156-000000000301','join',
  '15600000-0000-4156-8156-000000000913');
 PERFORM marcosa_private.r156_subscription(
  '15600000-0000-4156-8156-000000000003',
  '15600000-0000-4156-8156-000000000301','mute',
  '15600000-0000-4156-8156-000000000914');
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000004',false);
DO $$
BEGIN
 PERFORM marcosa_private.r156_subscription(
  '15600000-0000-4156-8156-000000000004',
  '15600000-0000-4156-8156-000000000301','join',
  '15600000-0000-4156-8156-000000000915');
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

-- Trusted block entered by the server; only Bob remains notification-eligible.
INSERT INTO public.marcosa_user_blocks(blocker_id,blocked_id)
 VALUES('15600000-0000-4156-8156-000000000001',
        '15600000-0000-4156-8156-000000000004');
SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000004',false);
DO $$
BEGIN
 BEGIN
  PERFORM marcosa_private.r156_bookmark(
   '15600000-0000-4156-8156-000000000004',
   '15600000-0000-4156-8156-000000000401',true,
   '15600000-0000-4156-8156-000000000916');
  RAISE EXCEPTION 'R156 blocked reader saved an episode';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%unavailable%' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000001',false);
DO $$
DECLARE published jsonb;
BEGIN
 published:=marcosa_private.r156_publish_episode(
  '15600000-0000-4156-8156-000000000001',
  '15600000-0000-4156-8156-000000000301',
  '15600000-0000-4156-8156-000000000203',
  '15600000-0000-4156-8156-000000000403',
  'New chapter three',2,'15600000-0000-4156-8156-000000000917');
 IF published->>'revision'<>'3' OR published->>'notificationJobs'<>'1'
 THEN RAISE EXCEPTION 'R156 publication notifications not audience-scoped: %',published; END IF;
 IF published IS DISTINCT FROM marcosa_private.r156_publish_episode(
  '15600000-0000-4156-8156-000000000001',
  '15600000-0000-4156-8156-000000000301',
  '15600000-0000-4156-8156-000000000203',
  '15600000-0000-4156-8156-000000000403',
  'New chapter three',2,'15600000-0000-4156-8156-000000000917')
 THEN RAISE EXCEPTION 'R156 duplicate publish produced new outbox rows'; END IF;
 BEGIN
  PERFORM marcosa_private.r156_publish_episode(
   '15600000-0000-4156-8156-000000000001',
   '15600000-0000-4156-8156-000000000301',
   '15600000-0000-4156-8156-000000000205',
   '15600000-0000-4156-8156-000000000405',
   'Draft must never publish',3,'15600000-0000-4156-8156-000000000918');
  RAISE EXCEPTION 'R156 attached an unpublished draft to season';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
DO $$
BEGIN
 IF (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='pending')<>1
 THEN RAISE EXCEPTION 'R156 duplicate or muted/blocked notification queued'; END IF;
 IF (SELECT count(*) FROM public.marcosa_season_audit WHERE series_id=
  '15600000-0000-4156-8156-000000000301' AND action='episode_attached')<>1
 THEN RAISE EXCEPTION 'R156 failed/deduplicated publishing produced extra audit'; END IF;
 IF EXISTS(SELECT 1 FROM public.marcosa_season_episodes
  WHERE id='15600000-0000-4156-8156-000000000405')
 THEN RAISE EXCEPTION 'R156 failed draft publishing left an episode'; END IF;
END $$;

SET ROLE marcosa_r156_dispatcher;
DO $$
DECLARE first_job record; retry_job record;
BEGIN
 SELECT * INTO first_job FROM marcosa_private.r156_claim('workerone',10,60);
 IF first_job.id IS NULL OR first_job.user_id<>
  '15600000-0000-4156-8156-000000000002'::uuid
 THEN RAISE EXCEPTION 'R156 worker received wrong recipient'; END IF;
 IF marcosa_private.r156_ack(first_job.id,gen_random_uuid())
 THEN RAISE EXCEPTION 'R156 wrong lease token acked an outbox job'; END IF;
 IF NOT marcosa_private.r156_nack(first_job.id,first_job.lease_token)
 THEN RAISE EXCEPTION 'R156 legitimate NACK rejected'; END IF;
 SELECT * INTO retry_job FROM marcosa_private.r156_claim('workertwo',10,60);
 IF retry_job.id IS DISTINCT FROM first_job.id
 OR retry_job.lease_token IS NOT DISTINCT FROM first_job.lease_token
 OR retry_job.attempts<>2
 THEN RAISE EXCEPTION 'R156 replay did not fence stale worker'; END IF;
 IF marcosa_private.r156_ack(first_job.id,first_job.lease_token)
 THEN RAISE EXCEPTION 'R156 stale lease was accepted'; END IF;
 IF NOT marcosa_private.r156_ack(retry_job.id,retry_job.lease_token)
 THEN RAISE EXCEPTION 'R156 valid ACK did not finish'; END IF;
 IF marcosa_private.r156_ack(retry_job.id,retry_job.lease_token)
 THEN RAISE EXCEPTION 'R156 repeated ACK accepted'; END IF;
 IF EXISTS(SELECT 1 FROM marcosa_private.r156_claim('workerthree',10,60))
 THEN RAISE EXCEPTION 'R156 acknowledged notification reclaimed'; END IF;
END $$;
RESET ROLE;

-- One pending notification is revoked atomically by user preference.
SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000001',false);
DO $$
BEGIN
 PERFORM marcosa_private.r156_publish_episode(
  '15600000-0000-4156-8156-000000000001',
  '15600000-0000-4156-8156-000000000301',
  '15600000-0000-4156-8156-000000000204',
  '15600000-0000-4156-8156-000000000404',
  'New chapter four',3,'15600000-0000-4156-8156-000000000919');
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
DO $$
BEGIN
 IF (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='pending')<>1
 THEN RAISE EXCEPTION 'R156 second notification not enqueued'; END IF;
END $$;

SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000002',false);
DO $$
DECLARE preference jsonb;
BEGIN
 preference:=marcosa_private.r156_subscription(
  '15600000-0000-4156-8156-000000000002',
  '15600000-0000-4156-8156-000000000301','mute',
  '15600000-0000-4156-8156-000000000920');
 IF preference->>'muted'<>'true'
 THEN RAISE EXCEPTION 'R156 reader could not pause notifications'; END IF;
 PERFORM marcosa_private.r156_subscription(
  '15600000-0000-4156-8156-000000000002',
  '15600000-0000-4156-8156-000000000301','unmute',
  '15600000-0000-4156-8156-000000000921');
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
DO $$
BEGIN
 IF (SELECT count(*) FROM marcosa_private.r156_outbox
 WHERE state='pending')<>0
 THEN RAISE EXCEPTION 'R156 unmute backfilled an old notification'; END IF;
 IF (SELECT count(*) FROM marcosa_private.r156_outbox WHERE state='acked')<>1
 THEN RAISE EXCEPTION 'R156 privacy revocation altered finished lease'; END IF;
END $$;

SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000001',false);
DO $$
DECLARE archived jsonb;
BEGIN
 archived:=marcosa_private.r156_publication(
  '15600000-0000-4156-8156-000000000001',
  '15600000-0000-4156-8156-000000000301',
  false,4,'15600000-0000-4156-8156-000000000922');
 IF archived->>'revision'<>'5'
 THEN RAISE EXCEPTION 'R156 archive revision missing'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
SET ROLE anon;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_seasons WHERE slug='alice-r156-series')
 THEN RAISE EXCEPTION 'R156 archive remained publicly discoverable'; END IF;
END $$;
RESET ROLE;
SET ROLE marcosa_r156_writer;
SELECT set_config('request.jwt.claim.sub','15600000-0000-4156-8156-000000000002',false);
DO $$
BEGIN
 IF (marcosa_private.r156_bookmark(
  '15600000-0000-4156-8156-000000000002',
  '15600000-0000-4156-8156-000000000401',false,
  '15600000-0000-4156-8156-000000000923')->>'saved')<>'false'
 THEN RAISE EXCEPTION 'R156 bookmark privacy withdrawal refused'; END IF;
 IF (marcosa_private.r156_attendance(
  '15600000-0000-4156-8156-000000000002',
  '15600000-0000-4156-8156-000000000401',false,
  '15600000-0000-4156-8156-000000000924')->>'present')<>'false'
 THEN RAISE EXCEPTION 'R156 consent withdrawal refused'; END IF;
 PERFORM marcosa_private.r156_subscription(
  '15600000-0000-4156-8156-000000000002',
  '15600000-0000-4156-8156-000000000301','leave',
  '15600000-0000-4156-8156-000000000925');
 BEGIN
  PERFORM marcosa_private.r156_subscription(
   '15600000-0000-4156-8156-000000000002',
   '15600000-0000-4156-8156-000000000301','unmute',
   '15600000-0000-4156-8156-000000000926');
  RAISE EXCEPTION 'R156 archived reader was allowed to unmute';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%unavailable%' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.marcosa_season_bookmarks WHERE user_id=
  '15600000-0000-4156-8156-000000000002')
 OR EXISTS(SELECT 1 FROM public.marcosa_season_attendance WHERE viewer_id=
  '15600000-0000-4156-8156-000000000002')
 OR EXISTS(SELECT 1 FROM public.marcosa_season_subscriptions WHERE user_id=
  '15600000-0000-4156-8156-000000000002')
 THEN RAISE EXCEPTION 'R156 private reader data not erased'; END IF;
END $$;
SELECT 'R156 subscriber privacy, fenced dispatcher, queue revocation and publication PASS' AS proof;
