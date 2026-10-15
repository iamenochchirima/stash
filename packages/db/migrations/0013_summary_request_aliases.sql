ALTER TABLE item_jobs ADD CONSTRAINT item_job_owner UNIQUE(id,user_id);
CREATE TABLE summary_requests (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 job_id uuid NOT NULL,
 resource_id uuid NOT NULL,
 requested_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,request_id),
 FOREIGN KEY(job_id,user_id) REFERENCES item_jobs(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(resource_id,user_id) REFERENCES resources(id,user_id) ON DELETE CASCADE
);
INSERT INTO summary_requests(user_id,request_id,job_id,resource_id,requested_revision)
 SELECT user_id,request_id,id,resource_id,input_revision FROM item_jobs WHERE kind='summary' AND request_id IS NOT NULL;
