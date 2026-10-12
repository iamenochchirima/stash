ALTER TABLE resources ADD COLUMN search_document tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || notes || ' ' || url)) STORED;
DROP INDEX resource_search;
CREATE INDEX resource_search_document ON resources USING gin(search_document);
CREATE INDEX resource_tags ON resources USING gin(tags);
