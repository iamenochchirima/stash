ALTER TABLE attachments ALTER COLUMN storage_key DROP NOT NULL;
ALTER TABLE attachments DROP CONSTRAINT attachments_state_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_state_check CHECK(state IN ('pending','uploading','queued','processing','ready','failed','missing'));
CREATE OR REPLACE FUNCTION enqueue_blob_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.storage_key IS NOT NULL THEN
  INSERT INTO blob_cleanup(user_id,storage_key) VALUES(OLD.user_id,OLD.storage_key) ON CONFLICT(storage_key) DO NOTHING;
 END IF;
 RETURN OLD;
END;
$$;
ALTER TABLE item_summaries ADD COLUMN imported_at timestamptz;
