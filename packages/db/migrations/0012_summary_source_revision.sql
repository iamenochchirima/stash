ALTER TABLE resources ADD COLUMN source_revision integer NOT NULL DEFAULT 1 CHECK(source_revision>0);
ALTER TABLE item_jobs ADD COLUMN source_revision integer NOT NULL DEFAULT 1 CHECK(source_revision>0);
