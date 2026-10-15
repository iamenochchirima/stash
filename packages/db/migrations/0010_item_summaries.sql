ALTER TABLE item_jobs ADD COLUMN request_id uuid;
ALTER TABLE item_jobs ADD COLUMN dispatched_at timestamptz;
CREATE UNIQUE INDEX summary_request_identity ON item_jobs(user_id,request_id) WHERE kind='summary' AND request_id IS NOT NULL;
CREATE TABLE item_summaries (
 resource_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_revision integer NOT NULL,
 source_hash text NOT NULL,
 source_snapshot jsonb NOT NULL,
 result jsonb NOT NULL,
 model text NOT NULL,
 prompt_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(resource_id,user_id) REFERENCES resources(id,user_id) ON DELETE CASCADE
);
-- Operational usage survives account deletion so deleting an account cannot reset global limits.
-- This table has no document text, names, email addresses or credentials.
CREATE TABLE summary_usage (
 job_id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 reserved_tokens integer NOT NULL CHECK(reserved_tokens BETWEEN 0 AND 60000),
 actual_tokens integer,
 cost_usd numeric(14,8) NOT NULL DEFAULT 0,
 outcome text NOT NULL DEFAULT 'reserved',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX summary_usage_account_day ON summary_usage(user_id,created_at);
CREATE INDEX summary_usage_time ON summary_usage(created_at);
