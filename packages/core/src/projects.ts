import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { type Database } from "@stash/db";
import { projectInput, projectUpdate, projectDelete, projectItemMove, projectDocumentRestore } from "@stash/shared";
import { AppError } from "./index.js";
import { items } from "./items.js";
import { z } from "zod";
export async function requireProject(
  db: Database,
  userId: string,
  id: string,
  write = false,
) {
  const result = await db.execute(
    sql`select id,archived_at from projects where id=${id} and user_id=${userId}`,
  );
  if (!result.rows.length) throw new AppError(404, "Project not found.");
  if (write && result.rows[0].archived_at)
    throw new AppError(
      409,
      "Reopen this project before changing its contents.",
    );
}
export async function requireProjectTextCapacity(
  db: Database,
  userId: string,
  additionalBody: string,
) {
  const result = await db.execute(
    sql`select (select coalesce(sum(octet_length(body)),0) from resources where user_id=${userId} and project_id is not null)+(select coalesce(sum(octet_length(body)),0) from project_item_history where user_id=${userId}) as bytes`,
  );
  if (
    Number(result.rows[0].bytes) + Buffer.byteLength(additionalBody) >
    100 * 1024 * 1024
  )
    throw new AppError(
      409,
      "Your project text and history limit has been reached. Remove unneeded research before adding more.",
    );
}
export async function recordProjectRevision(
  db: Database,
  userId: string,
  item: { id: string; revision: number; body: string },
  actor: string,
) {
  await db.execute(
    sql`insert into project_item_history(user_id,resource_id,revision,body,actor) values(${userId},${item.id},${item.revision},${item.body},${actor.slice(0, 80)}) on conflict(resource_id,revision) do nothing`,
  );
  await db.execute(
    sql`delete from project_item_history where resource_id=${item.id} and user_id=${userId} and id not in(select id from project_item_history where resource_id=${item.id} order by revision desc limit 20)`,
  );
}
export function projectService(db: Database, userId: string) {
  const active = async (tx: Database) => {
    const u = await tx.execute(
      sql`select id from users where id=${userId} and suspended_at is null for update`,
    );
    if (!u.rows.length) throw new AppError(403, "This account is unavailable.");
  };
  const columns = sql`p.id,p.name,p.description,p.repository_url as "repositoryUrl",p.revision,p.archived_at as "archivedAt",p.created_at as "createdAt",p.updated_at as "updatedAt",(select count(*)::int from resources r where r.project_id=p.id and r.deleted_at is null) as "itemCount"`;
  async function get(id: string) {
    const r = await db.execute(
      sql`select ${columns} from projects p where p.id=${id} and p.user_id=${userId}`,
    );
    if (!r.rows.length) throw new AppError(404, "Project not found.");
    return r.rows[0];
  }
  return {
    get,
    async list(archived = false, q = "") {
      return {
        items: (
          await db.execute(
            sql`select ${columns} from projects p where p.user_id=${userId} and (p.archived_at is not null)=${archived} and (p.name ilike ${"%" + q + "%"} or p.description ilike ${"%" + q + "%"}) order by p.created_at desc,p.id`,
          )
        ).rows,
      };
    },
    async create(raw: z.input<typeof projectInput>) {
      const input = projectInput.parse(raw);
      const id = await db.transaction(async (tx) => {
        await active(tx);
        const n = await tx.execute(
          sql`select count(*)::int as n from projects where user_id=${userId}`,
        );
        if (Number(n.rows[0].n) >= 100)
          throw new AppError(409, "Your project limit has been reached.");
        return String(
          (
            await tx.execute(
              sql`insert into projects(user_id,name,description,repository_url) values(${userId},${input.name},${input.description},${input.repositoryUrl || null}) returning id`,
            )
          ).rows[0].id,
        );
      });
      return get(id);
    },
    async update(id: string, raw: z.input<typeof projectUpdate>) {
      const input = projectUpdate.parse(raw);
      await db.transaction(async (tx) => {
        await active(tx);
        const result = await tx.execute(
          sql`select * from projects where id=${id} and user_id=${userId} for update`,
        );
        const row = result.rows[0];
        if (!row) throw new AppError(404, "Project not found.");
        if (row.revision !== input.revision)
          throw new AppError(
            409,
            "This project changed elsewhere. Reload before saving.",
          );
        await tx.execute(
          sql`update projects set name=${input.name ?? row.name},description=${input.description ?? row.description},repository_url=${input.repositoryUrl === undefined ? row.repository_url : input.repositoryUrl},archived_at=${input.archived === undefined ? row.archived_at : input.archived ? new Date() : null},revision=revision+1,updated_at=now() where id=${id}`,
        );
      });
      return get(id);
    },
    async remove(id: string, raw: z.input<typeof projectDelete>) {
      const input = projectDelete.parse(raw);
      return db.transaction(async tx => {
        await active(tx);
        const result = await tx.execute(sql`select revision,archived_at from projects where id=${id} and user_id=${userId} for update`);
        const row = result.rows[0];
        if (!row) throw new AppError(404, "Project not found.");
        if (row.revision !== input.revision) throw new AppError(409, "This project changed elsewhere. Reload before deleting.");
        if (!row.archived_at) throw new AppError(409, "Archive this project before deleting it.");
        const contents = await tx.execute(sql`select 1 from resources where project_id=${id} and user_id=${userId} limit 1`);
        if (contents.rows.length) throw new AppError(409, "Move or permanently delete all project items, including Trash, before deleting this project.");
        await tx.execute(sql`delete from projects where id=${id} and user_id=${userId}`);
        return { deleted: true };
      });
    },
    async moveItem(id: string, raw: z.input<typeof projectItemMove>) {
      const input = projectItemMove.parse(raw);
      await db.transaction(async tx => {
        await active(tx);
        const result = await tx.execute(sql`select project_id,revision,url,deleted_at from resources where id=${id} and user_id=${userId} for update`);
        const row = result.rows[0];
        if (!row || !row.project_id || row.deleted_at) throw new AppError(404, "Project item not found.");
        await requireProject(tx, userId, String(row.project_id), true);
        await requireProject(tx, userId, input.projectId, true);
        if (row.revision !== input.revision) throw new AppError(409, "This item changed elsewhere. Read it before moving.");
        if (row.project_id === input.projectId) return;
        if (row.url) {
          const duplicate = await tx.execute(sql`select 1 from resources where user_id=${userId} and project_id=${input.projectId} and url=${row.url}`);
          if (duplicate.rows.length) throw new AppError(409, "This link already exists in the destination project, including Trash.");
        }
        await tx.execute(sql`update resources set project_id=${input.projectId},revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
      });
      const item = await items(db, userId).get(id);
      return { ...item, body: item.body.slice(0, 30000), bodyTruncated: item.body.length > 30000 };
    },
    async restoreDocument(id: string, raw: z.input<typeof projectDocumentRestore>) {
      const input = projectDocumentRestore.parse(raw);
      await db.transaction(async tx => {
        await active(tx);
        const service = projectService(tx, userId);
        const previous = await service.history(id, input.historicalRevision);
        if (!("body" in previous)) throw new AppError(404, "Revision not found.");
        await items(tx, userId).update(id, { revision: input.revision, body: String(previous.body) });
      });
      return this.document(id);
    },
    async document(id: string, offset = 0) {
      const item = await items(db, userId).get(id);
      if (!item.projectId)
        throw new AppError(404, "Project document not found.");
      return {
        ...item,
        body: item.body.slice(offset, offset + 30000),
        offset,
        totalCharacters: item.body.length,
        nextOffset: offset + 30000 < item.body.length ? offset + 30000 : null,
      };
    },
    async history(id: string, revision?: number) {
      const item = await items(db, userId).get(id);
      if (!item.projectId)
        throw new AppError(404, "Project document not found.");
      if (revision !== undefined) {
        const result = await db.execute(
          sql`select revision,body,actor,created_at as "createdAt" from project_item_history where user_id=${userId} and resource_id=${id} and revision=${revision}`,
        );
        if (!result.rows.length) throw new AppError(404, "Revision not found.");
        return result.rows[0];
      }
      return {
        items: (
          await db.execute(
            sql`select revision,actor,created_at as "createdAt",length(body) as characters from project_item_history where user_id=${userId} and resource_id=${id} order by revision desc limit 20`,
          )
        ).rows,
      };
    },
    async append(
      id: string,
      input: { revision: number; requestId: string; body: string },
      actor = "agent",
    ) {
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ id, ...input }))
        .digest("hex");
      await db.transaction(async (tx) => {
        await active(tx);
        const old = await tx.execute(
          sql`select * from project_appends where user_id=${userId} and request_id=${input.requestId}`,
        );
        if (old.rows.length) {
          if (old.rows[0].fingerprint !== fingerprint)
            throw new AppError(
              409,
              "This append request was already used for different content.",
            );
          return;
        }
        const result = await tx.execute(
          sql`select id,project_id,revision,body,kind,deleted_at from resources where id=${id} and user_id=${userId} for update`,
        );
        const row = result.rows[0];
        if (!row || !row.project_id || row.deleted_at)
          throw new AppError(404, "Project document not found.");
        await requireProject(tx, userId, String(row.project_id), true);
        if (!["note", "idea"].includes(String(row.kind)))
          throw new AppError(400, "Append applies to notes and ideas.");
        if (row.revision !== input.revision)
          throw new AppError(
            409,
            "This document changed elsewhere. Read it before appending.",
          );
        const body = String(row.body) + "\n\n" + input.body.trim();
        if (body.length > 500000)
          throw new AppError(
            400,
            "Project documents support up to 500,000 characters.",
          );
        await requireProjectTextCapacity(tx, userId, body);
        await recordProjectRevision(
          tx,
          userId,
          { id, revision: Number(row.revision), body: String(row.body) },
          actor,
        );
        await tx.execute(
          sql`update resources set body=${body},revision=revision+1,source_revision=source_revision+1,updated_at=now() where id=${id}`,
        );
        await tx.execute(
          sql`insert into project_appends(user_id,request_id,resource_id,fingerprint,result_revision) values(${userId},${input.requestId},${id},${fingerprint},${Number(row.revision) + 1})`,
        );
      });
      return this.document(id);
    },
    async promote(id: string, input: { body?: string; requestId: string }) {
      return db.transaction(async (tx) => {
        await active(tx);
        const item = await items(tx, userId).get(id);
        if (!item.projectId)
          throw new AppError(400, "This item is already in the library.");
        const body =
          input.body ??
          (item.kind === "pdf"
            ? item.notes || item.title
            : item.body || item.notes || item.title);
        if (body.length > (item.kind === "link" ? 10000 : 50000))
          throw new AppError(
            400,
            "Choose an excerpt of up to 50,000 characters to save to the library.",
          );
        const result = await items(tx, userId).save(
          item.kind === "link"
            ? {
                kind: "link",
                url: item.url!,
                title: item.title,
                notes: body,
                tags: [],
                collectionIds: [],
                topicIds: [],
                requestId: input.requestId,
                status: "unread",
              }
            : {
                kind: "note",
                title: item.title,
                body,
                notes: "",
                tags: [],
                collectionIds: [],
                topicIds: [],
                requestId: input.requestId,
              },
        );
        if (!result.duplicate)
          await tx.execute(
            sql`update resources set project_source_id=${id} where id=${result.item.id} and user_id=${userId}`,
          );
        return { ...result, item: await items(tx, userId).get(result.item.id) };
      });
    },
  };
}
