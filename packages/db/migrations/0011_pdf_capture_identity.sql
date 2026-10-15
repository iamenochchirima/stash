ALTER TABLE attachments ADD COLUMN capture_input jsonb NOT NULL DEFAULT '{}';
ALTER TABLE attachments ADD COLUMN request_id uuid;
ALTER TABLE attachments ADD COLUMN request_fingerprint text;
CREATE UNIQUE INDEX attachment_request_identity ON attachments(user_id,request_id) WHERE request_id IS NOT NULL;
