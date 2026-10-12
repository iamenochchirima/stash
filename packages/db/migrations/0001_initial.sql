CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, password_hash text NOT NULL,
 name text NOT NULL, bio text NOT NULL DEFAULT '', interests text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS collections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS collection_owner_name ON collections(user_id, name);
CREATE TABLE IF NOT EXISTS resources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 url text NOT NULL, title text NOT NULL, notes text NOT NULL DEFAULT '', tags text[] NOT NULL DEFAULT '{}',
 collection_id uuid REFERENCES collections(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','reading','done')),
 source_agent text NOT NULL DEFAULT 'web', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS resource_owner_url ON resources(user_id, url);
CREATE INDEX IF NOT EXISTS resource_owner_created ON resources(user_id, created_at);
CREATE INDEX IF NOT EXISTS resource_search ON resources USING gin (to_tsvector('english', title || ' ' || notes || ' ' || url));
CREATE TABLE IF NOT EXISTS api_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 hash text NOT NULL UNIQUE, prefix text NOT NULL, name text NOT NULL, scope text NOT NULL CHECK(scope IN ('read','write')),
 created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
);
