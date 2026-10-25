-- MARCOSA R46: ISOLATED PostgreSQL REFERENCE ONLY (not production migration).
-- Run only after validated R30/R37/R41/R43 contract SQL in disposable CI.
-- Invite codes are high-entropy random values never stored; only SHA-256 hashes
-- are persisted. No browser (anon/authenticated) may inspect/redeem tickets.
BEGIN;

CREATE TABLE IF NOT EXISTS marcosa_private.pilot_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code_hash text NOT NULL UNIQUE CHECK(code_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 label text NOT NULL DEFAULT '' CHECK(length(label)<=60),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 used_at timestamptz,
 revoked_at timestamptz,
 CONSTRAINT marcosa_pilot_invite_ttl CHECK(
  expires_at>created_at AND expires_at<=created_at+interval '168 hours'
 ),
 CONSTRAINT marcosa_pilot_invite_redeemed CHECK(
  used_at IS NOT NULL OR used_by IS NULL
 ),
 CONSTRAINT marcosa_pilot_invite_no_revoked_and_used CHECK(
  used_at IS NULL OR revoked_at IS NULL
 )
);
CREATE INDEX IF NOT EXISTS marcosa_invites_creator_recent
 ON marcosa_private.pilot_invites(created_by,created_at DESC,id);
CREATE INDEX IF NOT EXISTS marcosa_invites_pending_expiry
 ON marcosa_private.pilot_invites(expires_at)
 WHERE used_at IS NULL AND revoked_at IS NULL;
ALTER TABLE marcosa_private.pilot_invites ENABLE ROW LEVEL SECURITY;

-- Unexposed private schema + no Data API grants. Role-aware issuance,
-- consuming and revocation must occur inside trusted server transactions
-- with identity/session/moderator checks; user metadata is NOT authority.
REVOKE ALL ON marcosa_private.pilot_invites FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA marcosa_private FROM PUBLIC,anon,authenticated;

COMMIT;
