ALTER TABLE challenges ADD COLUMN context TEXT;
ALTER TABLE credentials ADD COLUMN label TEXT NOT NULL DEFAULT 'Passkey';
ALTER TABLE credentials ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
CREATE TABLE recent_auth (
 session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE INDEX recent_auth_expiry ON recent_auth(expires_at);
CREATE TABLE recovery_codes (
 code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL
);
CREATE INDEX recovery_codes_user ON recovery_codes(user_id);
CREATE TRIGGER credential_capacity BEFORE INSERT ON credentials BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM credentials WHERE user_id=NEW.user_id)>=5 THEN RAISE(ABORT,'CREDENTIAL_CAPACITY') END;
END;
