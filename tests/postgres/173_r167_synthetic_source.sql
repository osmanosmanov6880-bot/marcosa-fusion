-- R167 synthetic isolated PG17 source. NEVER apply to live Supabase.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres'
 THEN RAISE EXCEPTION 'R167 refuses non-disposable database'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon')
 THEN CREATE ROLE anon NOLOGIN NOBYPASSRLS; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')
 THEN CREATE ROLE authenticated NOLOGIN NOBYPASSRLS; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='marcosa_r167_reader')
 THEN CREATE ROLE marcosa_r167_reader NOLOGIN NOBYPASSRLS; END IF;
END $$;
CREATE SCHEMA r167_ci;
REVOKE ALL ON SCHEMA r167_ci FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA r167_ci TO marcosa_r167_reader;
CREATE TABLE public.r167_episodes(
 id uuid PRIMARY KEY,
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 60),
 revision integer NOT NULL CHECK(revision>0)
);
ALTER TABLE public.r167_episodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.r167_episodes FROM PUBLIC,anon,authenticated;
INSERT INTO public.r167_episodes VALUES
 ('16700000-0000-4167-8167-000000000001','Synthetic Chapter A',1),
 ('16700000-0000-4167-8167-000000000002','Synthetic Chapter B',2),
 ('16700000-0000-4167-8167-000000000003','Synthetic Chapter C',3);

CREATE TABLE r167_ci.r167_sessions(
 id uuid PRIMARY KEY,active boolean NOT NULL, synthetic boolean NOT NULL
 CHECK(synthetic=true)
);
ALTER TABLE r167_ci.r167_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r167_ci.r167_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON r167_ci.r167_sessions TO marcosa_r167_reader;
CREATE POLICY r167_read_own_test_session ON r167_ci.r167_sessions
 FOR SELECT TO marcosa_r167_reader USING (synthetic=true);
INSERT INTO r167_ci.r167_sessions VALUES
 ('16700000-0000-4167-8167-000000000101',true,true),
 ('16700000-0000-4167-8167-000000000102',false,true);

CREATE TABLE r167_ci.r167_quarantine(
 id smallint PRIMARY KEY CHECK(id=1),
 closed boolean NOT NULL DEFAULT true CHECK(closed=true),
 generation integer NOT NULL CHECK(generation>=5)
);
ALTER TABLE r167_ci.r167_quarantine ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r167_ci.r167_quarantine FROM PUBLIC,anon,authenticated,
 marcosa_r167_reader;
INSERT INTO r167_ci.r167_quarantine VALUES(1,true,5);

CREATE TABLE r167_ci.r167_audit(
 seq integer PRIMARY KEY CHECK(seq BETWEEN 1 AND 3),
 category text NOT NULL CHECK(category IN('archive','quarantine','restore')),
 event_hash text NOT NULL CHECK(event_hash~'^[a-f0-9]{64}$')
);
ALTER TABLE r167_ci.r167_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r167_ci.r167_audit FROM PUBLIC,anon,authenticated,
 marcosa_r167_reader;
INSERT INTO r167_ci.r167_audit VALUES
 (1,'archive',repeat('a',64)),
 (2,'quarantine',repeat('b',64)),
 (3,'restore',repeat('c',64));
COMMIT;
SELECT 'R167_SYNTHETIC_PG17_RLS_FIXTURE=PASS';
