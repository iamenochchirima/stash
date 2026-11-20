# Import and export

Import / export opens file selection and export controls. Choose browser bookmark HTML or a version 1 Stash JSON export. The preview reports new, duplicate, invalid entries, and collections to create. Import commits valid entries separately, preserves existing notes, and reports failures using original file entry numbers.

Export my library downloads every saved resource and collection plus profile details, excluding authentication data. Exports use a consistent database snapshot. Import remaps IDs, preserves empty collections, metadata, timestamps, reading status, notes, and tags. It does not replace the account profile.

Drive the transfer browser journey and `tests/portability.test.ts`. Inspect the actual downloaded JSON, preview-before-write counts, partial import results, duplicate retries, foreign ownership fields, complete exports beyond one page, and a round trip into a fresh account.


JSON and ZIP v3 preserve user-created Topics, descriptions, empty topics, and multiple memberships. Existing v1/v2 imports remain supported. Legacy v1 export refuses accounts with topics to prevent silent loss. Bookmark preview reports topic organization omitted by HTML. See [Topics](topics.md) and `tests/topics-portability.test.ts` for focused round-trip checks.

Data-only JSON and full ZIP use v4 to carry Todo lists and tasks, saved-source links, subtasks, recurrence history, reminder records and timezone preferences. Restore keeps existing edits and pauses pending reminders; ZIP v2/v3 and JSON v1/v2/v3 remain importable. Check `tests/backup-todos.test.ts`, `tests/todos-portability.test.ts` and `tests/browser/backups.spec.ts` for round-trip and restore evidence.
