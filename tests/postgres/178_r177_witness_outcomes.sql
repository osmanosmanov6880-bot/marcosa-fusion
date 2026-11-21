-- R177 isolated PostgreSQL 17; synthetic source/offsite only.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR
    to_regclass('r174_ci.checkpoint_events') IS NULL OR
    to_regclass('r176_ci.admissions') IS NULL THEN
  RAISE EXCEPTION 'R177 requires disposable PG17 and previous real fixtures';
 END IF;
END $$;
CREATE SCHEMA r177_ci;
REVOKE ALL ON SCHEMA r177_ci FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r177_writer') THEN
  CREATE ROLE marcosa_r177_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA r177_ci,r174_ci,r176_ci TO marcosa_r177_writer;
GRANT SELECT ON r174_ci.checkpoint,r174_ci.checkpoint_events,
 r176_ci.admissions TO marcosa_r177_writer;
CREATE POLICY r177_checkpoint_observer ON r174_ci.checkpoint
 FOR SELECT TO marcosa_r177_writer USING(production_authorized=false);
CREATE POLICY r177_event_observer ON r174_ci.checkpoint_events
 FOR SELECT TO marcosa_r177_writer USING(true);
CREATE POLICY r177_admission_observer ON r176_ci.admissions
 FOR SELECT TO marcosa_r177_writer USING(production_authorized=false);
CREATE TABLE r177_ci.anchors(
 sequence bigint PRIMARY KEY CHECK(sequence BETWEEN 1 AND 32),
 source_commit char(40) NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 archive_sha256 char(64) NOT NULL CHECK(archive_sha256 ~ '^[a-f0-9]{64}$'),
 checkpoint_sha256 char(64) NOT NULL CHECK(checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
 anchor_sha256 char(64) NOT NULL UNIQUE CHECK(anchor_sha256 ~ '^[a-f0-9]{64}$'),
 object_sha256 char(64) NOT NULL UNIQUE CHECK(object_sha256 ~ '^[a-f0-9]{64}$'),
 version_id varchar(128) NOT NULL CHECK(version_id ~ '^[A-Za-z0-9_.-]{1,128}$'),
 prior_anchor_sha256 char(64) NOT NULL CHECK(prior_anchor_sha256 ~ '^[a-f0-9]{64}$'),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false)
);
CREATE TABLE r177_ci.anchor_audit(
 sequence bigint PRIMARY KEY REFERENCES r177_ci.anchors(sequence),
 anchor_sha256 char(64) NOT NULL CHECK(anchor_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE r177_ci.roots(
 sequence bigint PRIMARY KEY REFERENCES r177_ci.anchors(sequence),
 root_sha256 char(64) NOT NULL CHECK(root_sha256 ~ '^[a-f0-9]{64}$'),
 latest_object_sha256 char(64) NOT NULL CHECK(latest_object_sha256 ~ '^[a-f0-9]{64}$'),
 checkpoint_sha256 char(64) NOT NULL CHECK(checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
 anchor_count bigint NOT NULL CHECK(anchor_count BETWEEN 2 AND 32),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false)
);
CREATE TABLE r177_ci.outcomes(
 nonce char(32) PRIMARY KEY REFERENCES r176_ci.admissions(nonce),
 sequence bigint NOT NULL UNIQUE CHECK(sequence BETWEEN 2 AND 32),
 root_sha256 char(64) NOT NULL CHECK(root_sha256 ~ '^[a-f0-9]{64}$'),
 restored_state_sha256 char(64) NOT NULL CHECK(restored_state_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 production_authorized boolean NOT NULL DEFAULT false CHECK(production_authorized=false)
);
CREATE TABLE r177_ci.outcome_audit(
 nonce char(32) PRIMARY KEY REFERENCES r177_ci.outcomes(nonce),
 sequence bigint NOT NULL UNIQUE CHECK(sequence BETWEEN 2 AND 32),
 restored_state_sha256 char(64) NOT NULL CHECK(restored_state_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['anchors','anchor_audit','roots',
  'outcomes','outcome_audit'] LOOP
  EXECUTE format('ALTER TABLE r177_ci.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE r177_ci.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY r177_reader ON r177_ci.%I FOR SELECT TO marcosa_r177_writer USING(true)',t);
  EXECUTE format('CREATE POLICY r177_writer ON r177_ci.%I FOR INSERT TO marcosa_r177_writer WITH CHECK(true)',t);
  EXECUTE format('GRANT SELECT,INSERT ON r177_ci.%I TO marcosa_r177_writer',t);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA r177_ci
 FROM PUBLIC,anon,authenticated,marcosa_r167_reader;
DO $$ BEGIN
 IF has_table_privilege('authenticated','r177_ci.anchors','SELECT') OR
    has_table_privilege('marcosa_r177_writer','r174_ci.checkpoint','UPDATE') OR
    has_table_privilege('marcosa_r177_writer','r176_ci.admissions','INSERT') OR
    has_table_privilege('marcosa_r177_writer','r177_ci.outcomes','UPDATE') OR
    has_table_privilege('marcosa_r177_writer','r177_ci.outcome_audit','DELETE') THEN
  RAISE EXCEPTION 'R177 read/append-only role boundary violated';
 END IF;
END $$;
COMMIT;
SELECT 'R177_PG17_IMMUTABLE_HISTORY_AND_OUTCOME_RLS=PASS';
