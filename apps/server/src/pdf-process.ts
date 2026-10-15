import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
const execute = promisify(execFile);
const result = z.object({ pages: z.array(z.object({ page: z.number().int().min(1).max(100), text: z.string().max(250000) })).max(100), pageCount: z.number().int().min(1).max(100) });
export type PdfExtraction = z.infer<typeof result>;
export async function extractPdf(content: Buffer): Promise<PdfExtraction> {
  const directory = await mkdtemp(join(tmpdir(), "stash-pdf-"));
  try {
    const input = join(directory, "document.pdf"); await writeFile(input, content, { mode: 0o600 });
    const compiled = import.meta.url.endsWith(".js");
    const executable = fileURLToPath(new URL(compiled ? "./pdf-extract.js" : "./pdf-extract.mjs", import.meta.url));
    const args = ["--max-old-space-size=256", executable, input];
    let monitoring = true, memoryExceeded = false, monitor: ReturnType<typeof setInterval> | undefined;
    try {
      const pending = execute(process.execPath, args, { cwd: fileURLToPath(new URL("../", import.meta.url)), timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH || "", NODE_ENV: "production" } });
      if (process.platform === "linux" && pending.child.pid) {
        const pid = pending.child.pid;
        monitor = setInterval(() => {
          void readFile(`/proc/${pid}/status`, "utf8").then(status => {
            const rss = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0);
            if (monitoring && rss > 384 * 1024) { memoryExceeded = true; pending.child.kill("SIGKILL"); }
          }).catch(() => {});
        }, 50); monitor.unref();
      }
      const { stdout } = await pending;
      return result.parse(JSON.parse(stdout));
    } catch (error) {
      const e = error as { killed?: boolean; stderr?: string; signal?: string };
      const safe = ["password_protected", "too_many_pages", "too_much_text", "no_extractable_text", "invalid_pdf"].find(code => e.stderr?.trim() === code);
      throw new Error(memoryExceeded || e.signal === "SIGABRT" ? "processing_memory_limit" : e.killed ? "processing_timeout" : safe || "processing_failed");
    } finally { monitoring = false; clearInterval(monitor); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
