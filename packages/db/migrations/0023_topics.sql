ALTER TABLE collections ADD COLUMN kind text NOT NULL DEFAULT 'collection' CHECK(kind IN ('collection','topic'));
ALTER TABLE collections ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE collections ADD COLUMN normalized_name text;
ALTER TABLE collections ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE collections ADD CONSTRAINT topic_normalized_name CHECK(kind <> 'topic' OR normalized_name IS NOT NULL);
CREATE UNIQUE INDEX topic_owner_normalized_name ON collections(user_id,normalized_name) WHERE kind='topic';
