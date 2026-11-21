CREATE INDEX todos_trash_retention ON todos(trashed_at, id) WHERE trashed_at IS NOT NULL;
CREATE INDEX todo_reminder_retention ON todo_reminders(updated_at, id) WHERE status IN ('sent','failed','missed','cancelled','read','dismissed');
