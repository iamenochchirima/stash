import { mkdir, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { users, type Database } from "@stash/db";
export type DeletionJournal = {
  record: (id: string) => Promise<void>;
  apply: (db: Database) => Promise<number>;
};
export function createDeletionJournal(directory: string): DeletionJournal {
  const path = join(directory, "account-deletions.jsonl");
  return {
    async record(id) {
      z.string().uuid().parse(id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // Persist deletion intent before committing live deletion. On restart/restore, pending intents are completed conservatively.
      await appendFile(
        path,
        JSON.stringify({ userId: id, requestedAt: new Date().toISOString() }) +
          "\n",
        { mode: 0o600, flush: true },
      );
    },
    async apply(db) {
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
        throw error;
      }
      const entry = z.object({
        userId: z.string().uuid(),
        requestedAt: z.string().datetime(),
      });
      const ids = [
        ...new Set(
          content
            .split("\n")
            .filter(Boolean)
            .map((line) => entry.parse(JSON.parse(line)).userId),
        ),
      ];
      let removed = 0;
      for (let offset = 0; offset < ids.length; offset += 500)
        removed += (
          await db
            .delete(users)
            .where(inArray(users.id, ids.slice(offset, offset + 500)))
            .returning({ id: users.id })
        ).length;
      return removed;
    },
  };
}
