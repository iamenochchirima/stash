CREATE TABLE projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 import_origin_id uuid,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 repository_url text,
 revision integer NOT NULL DEFAULT 1,
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,import_origin_id),
 UNIQUE(id,user_id)
);
CREATE INDEX project_owner_created ON projects(user_id,created_at DESC,id);
ALTER TABLE resources ADD COLUMN project_id uuid;
ALTER TABLE resources ADD COLUMN project_source_id uuid REFERENCES resources(id) ON DELETE SET NULL;
ALTER TABLE resources ADD CONSTRAINT resource_owned_project FOREIGN KEY(project_id,user_id) REFERENCES projects(id,user_id);
-- Replace account-wide URL uniqueness with workspace-specific uniqueness.
DROP INDEX IF EXISTS resource_owner_url;
ALTER TABLE resources DROP CONSTRAINT IF EXISTS resources_user_id_url_unique;
CREATE UNIQUE INDEX resource_library_url ON resources(user_id,url) WHERE project_id IS NULL;
CREATE UNIQUE INDEX resource_project_url ON resources(user_id,project_id,url) WHERE project_id IS NOT NULL;
CREATE INDEX resource_project_created ON resources(user_id,project_id,created_at DESC,id);
CREATE TABLE project_item_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id uuid NOT NULL,
 revision integer NOT NULL,
 body text NOT NULL,
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(resource_id,user_id) REFERENCES resources(id,user_id) ON DELETE CASCADE,
 UNIQUE(resource_id,revision)
);
CREATE TABLE project_appends (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 resource_id uuid NOT NULL,
 fingerprint text NOT NULL,
 result_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(resource_id,user_id) REFERENCES resources(id,user_id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,request_id)
);
