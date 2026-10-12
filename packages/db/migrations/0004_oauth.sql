CREATE TABLE oauth_clients (
 id text PRIMARY KEY, name text NOT NULL, redirect_uris text[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE api_keys ADD COLUMN oauth_client_id text REFERENCES oauth_clients(id);
ALTER TABLE api_keys ADD COLUMN expires_at timestamptz;
ALTER TABLE api_keys ADD COLUMN oauth_resource text;
CREATE TABLE oauth_requests (
 hash text PRIMARY KEY, client_id text NOT NULL REFERENCES oauth_clients(id),
 redirect_uri text NOT NULL, resource text NOT NULL, scope text NOT NULL,
 state text NOT NULL, challenge text NOT NULL, user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE oauth_codes (
 hash text PRIMARY KEY, client_id text NOT NULL REFERENCES oauth_clients(id),
 redirect_uri text NOT NULL, resource text NOT NULL, scope text NOT NULL,
 challenge text NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE oauth_refresh_tokens (
 hash text PRIMARY KEY, key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE INDEX oauth_requests_expiry ON oauth_requests(expires_at);
CREATE INDEX oauth_codes_expiry ON oauth_codes(expires_at);
CREATE INDEX oauth_refresh_key ON oauth_refresh_tokens(key_id);
