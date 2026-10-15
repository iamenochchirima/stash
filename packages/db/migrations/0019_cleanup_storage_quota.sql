-- Keep reserved bytes charged until every remote object version has been removed.
-- Older cleanup records lack size information; use the maximum PDF size conservatively.
ALTER TABLE blob_cleanup ADD COLUMN byte_size integer NOT NULL DEFAULT 20971520 CHECK(byte_size BETWEEN 0 AND 20971520);
CREATE OR REPLACE FUNCTION enqueue_blob_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.storage_key IS NOT NULL THEN
  INSERT INTO blob_cleanup(user_id,storage_key,byte_size) VALUES(OLD.user_id,OLD.storage_key,OLD.byte_size) ON CONFLICT(storage_key) DO NOTHING;
 END IF;
 RETURN OLD;
END;
$$;
