-- Project contents remain protected from direct project deletion. Account deletion
-- cascades through both projects and their Todo data, so that cascade must pass.
CREATE OR REPLACE FUNCTION block_project_delete_with_todos() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM todos WHERE project_id = OLD.id AND user_id = OLD.user_id)
     OR EXISTS (SELECT 1 FROM todo_lists WHERE project_id = OLD.id AND user_id = OLD.user_id)
     OR EXISTS (SELECT 1 FROM todo_recurrences WHERE project_id = OLD.id AND user_id = OLD.user_id) THEN
    RAISE EXCEPTION 'project contains todo data' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;
