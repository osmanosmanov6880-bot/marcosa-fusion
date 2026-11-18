-- MARCOSA R165: disposable PG17 durable replay/quarantine reference.
-- NOT a managed Supabase migration and NOT approval to deploy.
BEGIN;
CREATE ROLE marcosa_r165_nonce_writer NOLOGIN NOBYPASSRLS;
CREATE ROLE marcosa_r165_gate_reader NOLOGIN NOBYPASSRLS;
CREATE ROLE marcosa_r165_gate_closer NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA marcosa_private TO
 marcosa_r165_nonce_writer,marcosa_r165_gate_reader,marcosa_r165_gate_closer;

CREATE TABLE marcosa_private.r165_drill_nonces(
 nonce text PRIMARY KEY CHECK(nonce ~ '^[a-f0-9]{32}$'),
 source_commit text NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 target_digest text NOT NULL CHECK(target_digest ~ '^[a-f0-9]{64}$'),
 scope text NOT NULL DEFAULT 'staging-rehearsal-only'
  CHECK(scope='staging-rehearsal-only'),
 synthetic boolean NOT NULL DEFAULT true CHECK(synthetic=true),
 issued_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '5 minutes')
);
CREATE INDEX r165_nonce_commit_idx ON marcosa_private.r165_drill_nonces(source_commit);
ALTER TABLE marcosa_private.r165_drill_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marcosa_private.r165_drill_nonces FROM PUBLIC,anon,authenticated,
 marcosa_r156_writer,marcosa_r156_dispatcher,marcosa_r159_auth_reader;
GRANT SELECT,INSERT ON marcosa_private.r165_drill_nonces TO marcosa_r165_nonce_writer;
CREATE POLICY r165_nonce_ci_read ON marcosa_private.r165_drill_nonces
 FOR SELECT TO marcosa_r165_nonce_writer USING(true);
CREATE POLICY r165_nonce_ci_insert ON marcosa_private.r165_drill_nonces
 FOR INSERT TO marcosa_r165_nonce_writer WITH CHECK(synthetic=true);

CREATE TABLE marcosa_private.r165_quarantine(
 id smallint PRIMARY KEY CHECK(id=1),
 closed boolean NOT NULL DEFAULT true,
 generation bigint NOT NULL DEFAULT 1 CHECK(generation>=1),
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO marcosa_private.r165_quarantine(id,closed) VALUES(1,true);
ALTER TABLE marcosa_private.r165_quarantine ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marcosa_private.r165_quarantine FROM PUBLIC,anon,authenticated,
 marcosa_r156_writer,marcosa_r156_dispatcher,marcosa_r159_auth_reader;
GRANT SELECT ON marcosa_private.r165_quarantine TO
 marcosa_r165_gate_reader,marcosa_r165_gate_closer;
GRANT UPDATE(closed,generation,changed_at) ON marcosa_private.r165_quarantine
 TO marcosa_r165_gate_closer;
CREATE POLICY r165_gate_ci_read ON marcosa_private.r165_quarantine
 FOR SELECT TO marcosa_r165_gate_reader,marcosa_r165_gate_closer USING(true);
CREATE POLICY r165_gate_ci_close ON marcosa_private.r165_quarantine
 FOR UPDATE TO marcosa_r165_gate_closer USING(true) WITH CHECK(closed=true);
COMMENT ON TABLE marcosa_private.r165_quarantine IS
 'R165 fail-closed by default. Only disposable CI superuser may open; app operator may close ONLY.';
COMMIT;
