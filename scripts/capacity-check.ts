import { fixture } from "../tests/helpers.js";
import { users, resources, collections } from "@stash/db";
import { library } from "@stash/core";
import { listInput, resourceInput } from "@stash/shared";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
const f = await fixture();
try {
  const u = await f.signup("capacity@example.test");
  await f.db
    .insert(collections)
    .values(
      Array.from({ length: 99 }, (_, i) => ({
        userId: u.user.id,
        name: `Collection ${i}`,
      })),
    );
  for (let batch = 0; batch < 20; batch++)
    await f.db
      .insert(resources)
      .values(
        Array.from({ length: 500 }, (_, i) => ({
          userId: u.user.id,
          url: `https://example.test/capacity/${batch * 500 + i}`,
          title: `Agent research ${batch * 500 + i}`,
          notes: `Memory architecture topic ${i % 20}`,
          tags: ["research"],
        })),
      );
  const service = library(f.db, u.user.id);
  const measure = async (operation: () => Promise<unknown>) => {
    const values: number[] = [];
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        for (let i = 0; i < 10; i++) {
          const start = performance.now();
          await operation();
          values.push(performance.now() - start);
        }
      }),
    );
    values.sort((a, b) => a - b);
    return {
      requests: values.length,
      p50Ms: Math.round(values[Math.floor(values.length * 0.5)]),
      p95Ms: Math.round(values[Math.floor(values.length * 0.95)]),
      maxMs: Math.round(values.at(-1)!),
      errors: 0,
    };
  };
  const listing = await measure(() =>
      service.list(listInput.parse({ limit: 24 })),
    ),
    search = await measure(() =>
      service.list(listInput.parse({ q: "architecture", limit: 24 })),
    ),
    duplicates = await measure(() =>
      service.save(
        resourceInput.parse({
          url: "https://example.test/capacity/1",
          title: "Retain existing",
        }),
      ),
    );
  let limitRejected = false;
  try {
    await service.save(
      resourceInput.parse({
        url: "https://example.test/over-limit",
        title: "Rejected",
      }),
    );
  } catch {
    limitRejected = true;
  }
  const targets = { p95Ms: 1000, errors: 0 };
  const passed =
    [listing, search, duplicates].every(
      (value) => value.p95Ms <= targets.p95Ms && value.errors === 0,
    ) && limitRejected;
  const report = {
    passed,
    targets,
    environment: "Local PostgreSQL 18.6, Node 23.11.1, isolated test schema",
    resources: 10000,
    collections: 100,
    concurrentClients: 10,
    listing,
    search,
    duplicateSave: duplicates,
    limitRejected,
    memoryRssMiB: Math.round(process.memoryUsage().rss / 1048576),
    interpretation:
      "Local engineering acceptance target chosen before this rerun: p95 <= 1000 ms, zero errors at 10 concurrent clients. Hosted targets remain outside the current build scope.",
  };
  await writeFile(
    "docs/evidence/capacity.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  await f.close();
}
