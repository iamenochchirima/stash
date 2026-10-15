CREATE TABLE backup_downloads (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_hash text NOT NULL REFERENCES sessions(hash) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 started_at timestamptz
);
CREATE INDEX backup_downloads_expiry ON backup_downloads(expires_at);
CREATE INDEX backup_downloads_owner ON backup_downloads(user_id);
