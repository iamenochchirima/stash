ALTER TABLE resources DROP CONSTRAINT resources_project_source_id_fkey;
ALTER TABLE resources ADD CONSTRAINT resource_owned_project_source FOREIGN KEY(project_source_id,user_id) REFERENCES resources(id,user_id) ON DELETE SET NULL(project_source_id);
CREATE INDEX project_history_owner ON project_item_history(user_id,resource_id,revision DESC);
