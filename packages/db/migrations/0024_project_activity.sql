-- Seed activity from existing research before tracking future mutations.
UPDATE projects p SET updated_at = greatest(p.updated_at, activity.latest)
FROM (SELECT project_id, user_id, max(updated_at) AS latest FROM resources
      WHERE project_id IS NOT NULL GROUP BY project_id, user_id) activity
WHERE p.id = activity.project_id AND p.user_id = activity.user_id;

CREATE FUNCTION record_project_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.project_id IS NOT NULL THEN
    UPDATE projects SET updated_at = greatest(updated_at, clock_timestamp())
    WHERE id = OLD.project_id AND user_id = OLD.user_id;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.project_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      UPDATE projects SET updated_at = greatest(updated_at, clock_timestamp(), NEW.updated_at)
      WHERE id = NEW.project_id AND user_id = NEW.user_id;
    ELSIF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      UPDATE projects SET updated_at = greatest(updated_at, clock_timestamp(), NEW.updated_at)
      WHERE id = NEW.project_id AND user_id = NEW.user_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER resource_project_activity AFTER INSERT OR UPDATE OR DELETE ON resources
FOR EACH ROW EXECUTE FUNCTION record_project_activity();
CREATE INDEX resource_owner_updated ON resources(user_id, updated_at DESC, id DESC);
CREATE INDEX project_owner_updated ON projects(user_id, updated_at DESC, id DESC);
