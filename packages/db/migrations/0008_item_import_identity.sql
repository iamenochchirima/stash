ALTER TABLE resources ADD COLUMN import_origin_id uuid;
CREATE UNIQUE INDEX item_import_origin_owner ON resources(user_id, import_origin_id) WHERE import_origin_id IS NOT NULL;
