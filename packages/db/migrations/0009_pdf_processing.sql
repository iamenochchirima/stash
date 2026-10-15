ALTER TABLE resources ADD COLUMN extracted_text text NOT NULL DEFAULT '';
ALTER TABLE resources DROP COLUMN search_document;
ALTER TABLE resources ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
 setweight(to_tsvector('english',title),'A') ||
 setweight(to_tsvector('english',notes || ' ' || body || ' ' || extracted_text),'B') ||
 setweight(to_tsvector('english',coalesce(url,'')),'C')
) STORED;
CREATE INDEX resource_search_document ON resources USING gin(search_document);
CREATE TABLE attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id uuid UNIQUE,
 storage_key text NOT NULL UNIQUE,
 filename text NOT NULL,
 byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520),
 content_hash text,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','uploading','queued','processing','ready','failed')),
 upload_token_hash text UNIQUE,
 upload_expires_at timestamptz NOT NULL,
 pages jsonb NOT NULL DEFAULT '[]',
 page_count integer,
 parser_version text,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (resource_id,user_id) REFERENCES resources(id,user_id) ON DELETE CASCADE
);
CREATE INDEX attachment_owner ON attachments(user_id);
CREATE INDEX attachment_upload_expiry ON attachments(upload_expires_at) WHERE resource_id IS NULL;
CREATE TABLE blob_cleanup (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 storage_key text NOT NULL UNIQUE,
 attempts integer NOT NULL DEFAULT 0,
 not_before timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blob_cleanup_ready ON blob_cleanup(not_before,lease_until);
CREATE FUNCTION enqueue_blob_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO blob_cleanup(user_id,storage_key) VALUES(OLD.user_id,OLD.storage_key)
 ON CONFLICT(storage_key) DO NOTHING;
 RETURN OLD;
END;
$$;
CREATE TRIGGER attachment_delete_cleanup AFTER DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION enqueue_blob_cleanup();
CREATE TABLE item_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id uuid NOT NULL,
 key_id uuid,
 kind text NOT NULL CHECK(kind IN ('extract','summary')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','cancelled','unknown')),
 input_revision integer NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 run_after timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 error_code text,
 source_hash text,
 source_snapshot text,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (resource_id,user_id) REFERENCES resources(id,user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX item_active_job ON item_jobs(resource_id,kind) WHERE state IN ('queued','running');
CREATE INDEX item_jobs_ready ON item_jobs(kind,state,run_after);
CREATE TABLE file_downloads (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 FOREIGN KEY(resource_id,user_id) REFERENCES resources(id,user_id) ON DELETE CASCADE
);
CREATE INDEX file_download_expiry ON file_downloads(expires_at);
