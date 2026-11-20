import { test } from "node:test";
import assert from "node:assert/strict";
import { localDateTimeToUtc, nextTodoOccurrenceDate, utcToLocalDateTime } from "@stash/shared";

test("Timed task deadlines preserve local wall time, choose the first repeated time, and advance through DST gaps",()=>{
  assert.equal(localDateTimeToUtc("2026-07-10T09:15","Africa/Johannesburg"),"2026-07-10T07:15:00.000Z");
  assert.equal(localDateTimeToUtc("2024-11-03T01:30","America/New_York"),"2024-11-03T05:30:00.000Z");
  assert.equal(localDateTimeToUtc("2024-03-10T02:30","America/New_York"),"2024-03-10T07:00:00.000Z");
  assert.equal(utcToLocalDateTime("2024-11-03T05:30:00.000Z","America/New_York"),"2024-11-03T01:30");
  assert.throws(()=>localDateTimeToUtc("2024-02-30T09:00","UTC"),/valid local date and time/i);
  assert.throws(()=>localDateTimeToUtc("2024-01-01T09:00","Not/AZone"),/valid IANA time zone/i);
});

test("Recurring calendar dates preserve weekly cadence, monthly anchors and skip missed periods",()=>{
  assert.equal(nextTodoOccurrenceDate("2026-11-20","2026-11-20","2026-11-20",{frequency:"daily",interval:2}),"2026-11-22");
  assert.equal(nextTodoOccurrenceDate("2026-11-20","2026-11-20","2026-11-27",{frequency:"daily",interval:2}),"2026-11-28");
  assert.equal(nextTodoOccurrenceDate("2026-11-18","2026-11-18","2026-11-18",{frequency:"weekly",interval:1,weekdays:[1,3,5]}),"2026-11-20");
  assert.equal(nextTodoOccurrenceDate("2026-01-31","2026-02-28","2026-02-28",{frequency:"monthly",interval:1}),"2026-03-31");
  assert.equal(nextTodoOccurrenceDate("2026-11-20","2026-11-20","2026-11-20",{frequency:"daily",interval:1},"2026-11-20"),null);
  assert.throws(()=>nextTodoOccurrenceDate("2026-11-20","2026-11-20","2026-11-20",{frequency:"daily",interval:0}),/interval/i);
});
