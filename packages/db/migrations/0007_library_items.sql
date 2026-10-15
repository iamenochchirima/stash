ALTER TABLE resources ALTER COLUMN url DROP NOT NULL;
ALTER TABLE resources ADD COLUMN kind text NOT NULL DEFAULT 'link' CHECK (kind IN ('link','note','idea','pdf'));
ALTER TABLE resources ADD COLUMN body text NOT NULL DEFAULT '';
ALTER TABLE resources ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE resources ADD COLUMN favourite boolean NOT NULL DEFAULT false;
ALTER TABLE resources ADD COLUMN archived_at timestamptz;
ALTER TABLE resources ADD COLUMN deleted_at timestamptz;
ALTER TABLE resources ADD CONSTRAINT item_kind_content CHECK (
 (kind='link' AND url IS NOT NULL AND length(url)>0)
 OR (kind IN ('note','idea') AND url IS NULL AND length(trim(body))>0)
 OR (kind='pdf' AND url IS NULL)
);
ALTER TABLE resources DROP COLUMN search_document;
ALTER TABLE resources ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
 setweight(to_tsvector('english',title),'A') ||
 setweight(to_tsvector('english',notes || ' ' || body),'B') ||
 setweight(to_tsvector('english',coalesce(url,'')),'C')
) STORED;
CREATE INDEX resource_search_document ON resources USING gin(search_document);
CREATE INDEX item_owner_state_created ON resources(user_id, deleted_at, archived_at, created_at DESC, id);
CREATE INDEX item_trash_purge ON resources(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE TABLE item_requests (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 fingerprint text NOT NULL,
 item_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY (user_id,request_id)
);
CREATE INDEX item_requests_expiry ON item_requests(expires_at);
