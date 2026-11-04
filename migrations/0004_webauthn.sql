-- WebAuthn passkey challenges (Part 8.2 / A15). One-time, short-lived challenges.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  challenge   TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('REGISTER','AUTHENTICATE')),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user ON webauthn_challenges(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id, revoked_at);
