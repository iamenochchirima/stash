ALTER TABLE todo_lists ADD COLUMN import_origin_id uuid;
CREATE UNIQUE INDEX todo_list_import_origin ON todo_lists(user_id,import_origin_id) WHERE import_origin_id IS NOT NULL;

ALTER TABLE todo_recurrences ADD COLUMN import_origin_id uuid;
CREATE UNIQUE INDEX todo_recurrence_import_origin ON todo_recurrences(user_id,import_origin_id) WHERE import_origin_id IS NOT NULL;

ALTER TABLE todos ADD COLUMN import_origin_id uuid;
CREATE UNIQUE INDEX todo_import_origin ON todos(user_id,import_origin_id) WHERE import_origin_id IS NOT NULL;
