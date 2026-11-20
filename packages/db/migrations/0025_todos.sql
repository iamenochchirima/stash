CREATE TABLE todo_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (id, user_id, project_id),
  FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX todo_personal_list_owner_name ON todo_lists(user_id, lower(name)) WHERE project_id IS NULL;
CREATE UNIQUE INDEX todo_project_list_owner_name ON todo_lists(user_id, project_id, lower(name)) WHERE project_id IS NOT NULL;
CREATE INDEX todo_list_owner_scope ON todo_lists(user_id, project_id, position, id);

CREATE FUNCTION enforce_todo_list_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE list_project uuid;
BEGIN
  IF NEW.list_id IS NOT NULL THEN
    SELECT project_id INTO list_project FROM todo_lists
      WHERE id = NEW.list_id AND user_id = NEW.user_id;
    IF NOT FOUND OR list_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'todo list scope does not match task scope' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE todo_recurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid,
  rule jsonb NOT NULL CHECK (jsonb_typeof(rule) = 'object'),
  timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 100),
  anchor_date date NOT NULL,
  local_time time,
  ends_on date,
  remaining_count integer CHECK (remaining_count IS NULL OR remaining_count > 0),
  active boolean NOT NULL DEFAULT true,
  current_todo_id uuid UNIQUE,
  completed_count integer NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
);

CREATE TABLE todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid,
  list_id uuid,
  recurrence_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  state text NOT NULL DEFAULT 'todo' CHECK (state IN ('todo','in_progress','done')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  planned_date date,
  deadline_date date,
  deadline_at timestamptz,
  timezone text NOT NULL DEFAULT 'UTC' CHECK (length(timezone) BETWEEN 1 AND 100),
  completed_at timestamptz,
  trashed_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  CHECK (deadline_date IS NULL OR deadline_at IS NULL),
  FOREIGN KEY (project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (list_id, user_id) REFERENCES todo_lists(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (list_id, user_id, project_id) REFERENCES todo_lists(id, user_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (recurrence_id, user_id) REFERENCES todo_recurrences(id, user_id) ON DELETE SET NULL (recurrence_id)
);
ALTER TABLE todo_recurrences ADD CONSTRAINT todo_recurrence_current FOREIGN KEY (current_todo_id, user_id) REFERENCES todos(id, user_id) ON DELETE SET NULL (current_todo_id);
CREATE INDEX todo_owner_state ON todos(user_id, state, trashed_at, deadline_date, deadline_at, position, id);
CREATE INDEX todo_project_state ON todos(user_id, project_id, state, trashed_at, position, id);
CREATE INDEX todo_list_state ON todos(user_id, list_id, state, trashed_at, position, id);
CREATE INDEX todo_owner_updated ON todos(user_id, updated_at DESC, id DESC);
CREATE INDEX todo_due ON todos(user_id, deadline_at) WHERE deadline_at IS NOT NULL AND trashed_at IS NULL AND state <> 'done';
CREATE INDEX todo_date_due ON todos(user_id, deadline_date) WHERE deadline_date IS NOT NULL AND trashed_at IS NULL AND state <> 'done';
CREATE TRIGGER todo_list_scope BEFORE INSERT OR UPDATE OF list_id, project_id, user_id ON todos
FOR EACH ROW EXECUTE FUNCTION enforce_todo_list_scope();

CREATE TABLE todo_subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  todo_id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  completed_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (todo_id, user_id) REFERENCES todos(id, user_id) ON DELETE CASCADE
);
CREATE INDEX todo_subtask_order ON todo_subtasks(user_id, todo_id, position, id);

CREATE TABLE todo_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  todo_id uuid NOT NULL,
  resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (todo_id, resource_id),
  FOREIGN KEY (todo_id, user_id) REFERENCES todos(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id, user_id) REFERENCES resources(id, user_id) ON DELETE SET NULL (resource_id)
);
CREATE INDEX todo_source_resource ON todo_sources(user_id, resource_id);

CREATE TABLE todo_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recurrence_id uuid NOT NULL,
  todo_id uuid NOT NULL UNIQUE,
  occurrence_number integer NOT NULL CHECK (occurrence_number > 0),
  scheduled_date date NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recurrence_id, occurrence_number),
  FOREIGN KEY (recurrence_id, user_id) REFERENCES todo_recurrences(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (todo_id, user_id) REFERENCES todos(id, user_id) ON DELETE CASCADE
);

CREATE TABLE todo_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  todo_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app','email')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','missed','cancelled','read','dismissed')),
  scheduled_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  dismissed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (todo_id, user_id) REFERENCES todos(id, user_id) ON DELETE CASCADE
);
CREATE INDEX todo_reminder_claim ON todo_reminders(status, scheduled_at, lease_until) WHERE status IN ('pending','sending');
CREATE INDEX todo_reminder_inbox ON todo_reminders(user_id, status, scheduled_at DESC, id DESC) WHERE channel = 'in_app';

CREATE TABLE todo_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'UTC' CHECK (length(timezone) BETWEEN 1 AND 100),
  email_reminders boolean NOT NULL DEFAULT false,
  in_app_reminders boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE todo_requests (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  action text NOT NULL,
  fingerprint text NOT NULL,
  todo_id uuid,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id),
  FOREIGN KEY (todo_id, user_id) REFERENCES todos(id, user_id) ON DELETE SET NULL (todo_id)
);
CREATE INDEX todo_request_retention ON todo_requests(created_at);

CREATE OR REPLACE FUNCTION record_todo_project_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.project_id IS NOT NULL THEN
    UPDATE projects SET updated_at = greatest(updated_at, clock_timestamp())
    WHERE id = OLD.project_id AND user_id = OLD.user_id;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.project_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      UPDATE projects SET updated_at = greatest(updated_at, clock_timestamp())
      WHERE id = NEW.project_id AND user_id = NEW.user_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER todo_project_activity AFTER INSERT OR UPDATE OR DELETE ON todos
FOR EACH ROW EXECUTE FUNCTION record_todo_project_activity();

-- Projects cannot be permanently removed while task data, including Trash, still belongs to them.
CREATE OR REPLACE FUNCTION block_project_delete_with_todos() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM todos WHERE project_id = OLD.id AND user_id = OLD.user_id)
     OR EXISTS (SELECT 1 FROM todo_lists WHERE project_id = OLD.id AND user_id = OLD.user_id)
     OR EXISTS (SELECT 1 FROM todo_recurrences WHERE project_id = OLD.id AND user_id = OLD.user_id) THEN
    RAISE EXCEPTION 'project contains todo data' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER project_todo_delete_guard BEFORE DELETE ON projects
FOR EACH ROW EXECUTE FUNCTION block_project_delete_with_todos();
