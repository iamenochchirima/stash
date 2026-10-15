CREATE SEQUENCE storage_file_event_order AS bigint;
CREATE TABLE storage_file_ledger (
 storage_key text PRIMARY KEY,
 user_id uuid NOT NULL CHECK(split_part(storage_key,'/',1)=user_id::text),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 0 AND 20971520),
 state text NOT NULL CHECK(state IN ('put','remove','removed')),
 last_event_seq bigint NOT NULL,
 recorded_at timestamptz NOT NULL
);
CREATE INDEX storage_file_ledger_state ON storage_file_ledger(state);
