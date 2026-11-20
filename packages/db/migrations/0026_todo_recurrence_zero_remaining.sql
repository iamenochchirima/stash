ALTER TABLE todo_recurrences
  DROP CONSTRAINT todo_recurrences_remaining_count_check;

ALTER TABLE todo_recurrences
  ADD CONSTRAINT todo_recurrences_remaining_count_check
  CHECK (remaining_count IS NULL OR remaining_count >= 0);
