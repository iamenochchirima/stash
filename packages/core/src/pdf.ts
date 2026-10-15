import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
import { AppError } from "./index.js";
import { items } from "./items.js";
export async function readPdfPages(db: Database, userId: string, id: string, from = 1) {
  if (!Number.isInteger(from) || from < 1 || from > 100) throw new AppError(400, "Choose a page from 1 to 100.");
  const item = await items(db, userId).get(id);
  if (item.kind !== "pdf") throw new AppError(404, "PDF not found.");
  const found = await db.execute(sql`select state,pages,page_count,error_code from attachments where resource_id=${id} and user_id=${userId}`);
  if (!found.rows.length) throw new AppError(404, "PDF not found.");
  const row = found.rows[0], pages = row.pages as { page: number; text: string }[];
  // Maximum five pages and 30,000 characters total per read, including MCP responses.
  let remaining = 30000;
  return { id, state: row.state, pageCount: row.page_count, errorCode: row.error_code,
    pages: pages.slice(from - 1, from + 4).map(p => { const text = p.text.slice(0, remaining); remaining -= text.length; return { ...p, text, truncated: text.length < p.text.length }; }) };
}
