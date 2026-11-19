import { test } from "node:test";
import assert from "node:assert/strict";
import { updatedTime } from "../apps/web/lib/updated-time.js";
test("Updated timestamps show relative units through day 30, then an unambiguous date", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  for (const [age, label] of [[5000,"5 sec"],[60000,"1 min"],[120000,"2 min"],[3600000,"1 hour"],[7200000,"2 hours"],[86400000,"1 day"],[6*86400000,"6 days"],[30*86400000,"30 days"]] as const)
    assert.equal(updatedTime(new Date(now-age).toISOString(),now),`Updated ${label} ago`);
  assert.equal(updatedTime(new Date(now-31*86400000).toISOString(),now),"Updated 19 Oct 2026");
  assert.equal(updatedTime("2025-01-02T00:00:00Z",now),"Updated 2 Jan 2025");
  assert.equal(updatedTime(new Date(now+5000).toISOString(),now),"Updated 0 sec ago");
  assert.equal(updatedTime("bad",now),"Updated date unavailable");
  assert.equal(updatedTime("2026-11-19T12:00:00Z"),"Updated 19 Nov 2026");
});
