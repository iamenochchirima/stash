ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN avatar text;
ALTER TABLE users ADD COLUMN profile_completed_at timestamptz;
ALTER TABLE users ADD COLUMN first_saved_at timestamptz;
ALTER TABLE users ADD COLUMN first_organized_at timestamptz;
ALTER TABLE users ADD COLUMN agent_connected_at timestamptz;
ALTER TABLE users ADD COLUMN agent_retrieved_at timestamptz;
CREATE TABLE account_tokens (
 hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('verify','reset')), expires_at timestamptz NOT NULL
);
CREATE INDEX account_token_owner ON account_tokens(user_id, purpose);
CREATE INDEX session_owner ON sessions(user_id);
CREATE UNIQUE INDEX collection_id_owner ON collections(id, user_id);
CREATE UNIQUE INDEX resource_id_owner ON resources(id, user_id);
CREATE TABLE resource_collections (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id uuid NOT NULL, collection_id uuid NOT NULL,
 PRIMARY KEY(resource_id, collection_id),
 FOREIGN KEY(resource_id, user_id) REFERENCES resources(id, user_id) ON DELETE CASCADE,
 FOREIGN KEY(collection_id, user_id) REFERENCES collections(id, user_id) ON DELETE CASCADE
);
CREATE INDEX membership_owner_collection ON resource_collections(user_id, collection_id);
INSERT INTO resource_collections(user_id,resource_id,collection_id)
SELECT r.user_id,r.id,r.collection_id FROM resources r JOIN collections c ON c.id=r.collection_id AND c.user_id=r.user_id;
ALTER TABLE resources DROP COLUMN collection_id;
ALTER TABLE resources ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE resources ADD COLUMN metadata_status text NOT NULL DEFAULT 'manual' CHECK(metadata_status IN ('manual','extracted','unavailable'));
