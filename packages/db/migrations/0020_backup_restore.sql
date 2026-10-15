CREATE TABLE backup_restores (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 session_hash text REFERENCES sessions(hash) ON DELETE SET NULL,
 manifest jsonb,
 manifest_hash text,
 created_projects uuid[] NOT NULL DEFAULT '{}',
 busy_until timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX backup_restores_expiry ON backup_restores(expires_at);
CREATE TABLE backup_restore_items (
 transfer_hash text NOT NULL REFERENCES backup_restores(token_hash) ON DELETE CASCADE ON UPDATE CASCADE,
 origin_id uuid NOT NULL,
 resource_id uuid REFERENCES resources(id) ON DELETE SET NULL,
 source_origin_id uuid,
 created boolean NOT NULL DEFAULT false,
 PRIMARY KEY(transfer_hash,origin_id)
);
