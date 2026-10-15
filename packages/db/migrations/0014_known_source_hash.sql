ALTER TABLE resources ADD COLUMN known_source_hash text;
UPDATE resources r SET known_source_hash=s.source_hash FROM item_summaries s
 WHERE s.resource_id=r.id AND r.kind='link';
