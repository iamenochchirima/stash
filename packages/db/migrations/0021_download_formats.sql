ALTER TABLE backup_downloads ADD COLUMN format text NOT NULL DEFAULT 'zip' CHECK(format IN ('zip','json','bookmarks'));
