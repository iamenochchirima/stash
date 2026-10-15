---
name: verify-stash
description: Launch Stash's real web dashboard and PostgreSQL API, drive account and library journeys, and capture screenshots and persisted results. Use after changing Stash user-facing behavior or preparing a release.
---

# Verify Stash

The canonical feature map is [docs/features/README.md](../../../docs/features/README.md). The first-release requirements remain in [IMPLEMENTATION.md](../../../IMPLEMENTATION.md); the feature map describes current behavior.

## Launch

From the repository root, run `pnpm install --frozen-lockfile`, `./scripts/postgres-local.sh start`, and `pnpm exec playwright install chromium`. Set `TEST_DATABASE_URL` if using an existing PostgreSQL test database. Its name must end in `_test`.

Run `pnpm test:browser`. The harness uses `.next-verification` for isolated Next.js output so it can run alongside the local review server. It launches an API on `127.0.0.1:4100` with a disposable PostgreSQL schema a Next.js dashboard on `127.0.0.1:3100`, and a separate admin client on `127.0.0.1:3101`. Development emails are captured in private `.data/verification-mail` files, never sent. This suite starts and cleans up its own instances; do not launch another suite on those ports simultaneously.

For normal manual use, run `pnpm db:migrate` then `pnpm dev` and open `http://127.0.0.1:3000`. Manual instances use the development library, so automated checks should use the isolated harness instead.

## Doctor

Before driving a manually running instance, check `GET /health` for version `0.1.0` and `GET /ready` for status 200 on its API port. Confirm the ports belong to this run and the configured `WEB_ORIGIN` matches the browser URL. If the harness says a port is occupied, stop and identify its owner; never reuse or kill an unknown process.

For the managed browser suite, Playwright checks API readiness and both client URLs before driving. If readiness fails, inspect `docs/evidence/browser-tests.txt` or the server output before trying UI actions.

## Drive

`tests/browser/journeys.spec.ts` is the canonical browser recipe. It uses stable accessible selectors such as `Sign up`, `Your name`, `Email address`, `Password`, `Create account`, `Add item`, `Link`, `Title`, `Why it matters`, `Search your library`, `Import / export`, and `Open profile`.

Check the reference-style centered hero folder, surrounding assistant cards, and content tiles travelling along curved routes at desktop and 375px widths, including no horizontal overflow while the animation is running and static artwork with reduced motion. Follow Connect your agent to /signin and verify the sign-in form. The public MCP section has only the connection diagram and action, without a headline. Start at the public landing page, follow Sign up to `/signup`, and use `/signin` for returning users. The public page has a 13-second illustrated agent-save demo without a visible playback bar, chapter tabs, or caption. Check automatic start and looping, offscreen pause/resume, manual pause persistence, actual typing, a pause control revealed on hover or keyboard focus, example confirmation, card movement, and reduced motion with tests/browser/demo.spec.ts. Drive the actual user path: create an account, save a resource, follow the locally captured verification email, edit collections and reading status, search, import/export, manage an agent key, update the profile, sign out/in, and delete the account with reauthentication. The recovery test requests and follows a real captured email, then rejects a reused link. Mobile tests drive saving and keyboard dialogs at 375 and 768 pixels; the desktop test uses 1440 pixels.

Check the compact Getting started disclosure opens and closes, resource cards omit metadata-processing labels, and profile Bio editing still persists. `tests/browser/accessibility.spec.ts` checks signup, library, save dialog, and profile using axe. Keyboard focus, Escape, dialog focus return, and layout overflow have dedicated browser assertions.

`pnpm test` covers PostgreSQL-backed account, ownership, library, import/export, and MCP behavior. `pnpm exec tsx scripts/clients-check.ts` verifies real Codex/OpenCode clients only where both have functioning model access. Never substitute an SDK test for that actual client acceptance.

For OAuth, run tests/browser/oauth.spec.ts. It uses the official SDK for discovery/DCR/PKCE/token exchange and real browser signup, verification and consent, then saves/retrieves through MCP and revokes in the dashboard. Only the client callback is intercepted. Capture consent and connection screenshots, never tokens. tests/oauth.test.ts checks redirect/resource validation, PKCE, single use/racing codes, permissions, expiry, refresh rotation/replay, client binding, consent isolation, denial, and reset revocation. Record native-client acceptance separately from SDK acceptance.

## Library v2 journey

Read LIBRARY_V2_IMPLEMENTATION.md and docs/features/library-v2.md. Run pnpm test:browser tests/browser/item-detail.spec.ts tests/browser/items.spec.ts tests/browser/journeys.spec.ts tests/browser/accessibility.spec.ts for the mixed-item consumer foundation. Check card-body/title navigation, separate source/edit controls, direct links after sign-in, foreign-account rejection, full content, Markdown safety, favourites, archive, Trash/restore, filter/back navigation, mobile overflow and persisted edits. Tests/items*.test.ts cover migration, ownership, request identity, revision conflicts, lifecycle and JSON v2 round-trip. tests/mcp.test.ts covers two-client notes/ideas and legacy link compatibility. For PDFs run tests/browser/pdf.spec.ts at desktop/mobile widths and tests/pdf.test.ts plus tests/mcp.test.ts. Check private upload, extracted page text, original byte download, metadata edits, search and retry/failure states. The browser harness uses private disposable local storage and removes it with the schema. Real B2 verification uses `node --env-file=.env.local --import tsx scripts/check-private-storage.ts` with private local values. It must use synthetic originals and remove all versions afterward. For summaries run tests/summaries.test.ts, tests/mcp.test.ts and tests/browser/summaries.spec.ts. Drive Summarise, source references, refresh/regeneration, preserved notes and cancellation. Browser tests use an external-provider test double; real inference is separate: `node --env-file=.env.local --import tsx scripts/check-summaries.ts` with private free-model credentials. Inspect source claims, references, partial/stale flags, usage and cleanup. Read docs/summary-processing.md. Hosted and native-client acceptance remain pending; do not claim them from local tests.

## Export and agent help

Run tests/bookmarks.test.ts and tests/browser/exports.spec.ts. Inspect the actual HTML download for escaped titles/URLs and omitted project/Trash/non-link content. Check the UI omission count before download. Verify JSON native download still includes mixed content and the same one-use/session rules apply to all formats. The large JSON test checks per-item chunks. Read /help for URL-free save/find examples, project scope, archive/Trash behavior and file/backup limits. Run the complete journeys.spec.ts account/import/export scenario after changing download formats.

## Backup journey

Run tests/backup-archive.test.ts, tests/backup-routes.test.ts, tests/backup-restore.test.ts, tests/items-portability.test.ts and tests/browser/backups.spec.ts. Check actual downloaded ZIP contents and original byte equality, session-bound permission expiry/replay/logout, account isolation, malformed archive rejection and legal maximum project history. Inspect CacheStorage after the streaming download; private backup paths must never be cached by either worker. Data-only PDF restore must preserve saved text, label the missing original and disable its download. Restore the full ZIP into a second account and repair a prior data-only PDF without losing notes or summary provenance. Check project history/copied sources/Trash, permission rotation, interrupted retry, logout and account deletion during original upload. For real B2 acceptance, run `node --env-file=.env.local --import tsx scripts/check-backup-storage.ts`; it uses disposable PostgreSQL schemas and synthetic originals and must remove all versions afterward. These checks do not imply hosted rollout is complete. File integrity and cleanup-byte quota checks live in tests/pdf.test.ts.

## Admin journey

Read [ADMIN_IMPLEMENTATION.md](../../../ADMIN_IMPLEMENTATION.md) and [docs/features/admin.md](../../../docs/features/admin.md). Run pnpm test:browser tests/browser/admin.spec.ts for the focused owner/operator/viewer journey. The harness bootstraps a synthetic owner into its private captured mailbox and generates a disposable encryption key. It drives real invitation enrolment, password/TOTP authentication, one-time recovery codes, 7/30-day metrics, query-only pagination, filtered user detail/back navigation, suspension/restoration with API/MCP denial, audit, owner deletion, authenticator replacement, viewer/operator enrolment, operator suspension/restoration, and owner-only denial. It cleans up customer fixtures through real deletion endpoints.

Admin enrolment, MFA replacement and recovery-code screens contain credentials. Traces and automatic failure screenshots are disabled for this test. Never capture a live invitation URL, QR, setup key or recovery codes. Safe metadata screenshots go under docs/evidence/admin. Check mobile overflow and axe, native dialog focus and labels. Admin integration tests in tests/admin.test.ts cover permission boundaries, expiry/replay, races, provider failures, durable deletion, retention and origin aliases against disposable PostgreSQL schemas.

Run pnpm exec tsx scripts/admin-capacity-check.ts separately for paginated aggregate/index evidence. Run the recovery drill only after other Stash tests stop. Production bootstrap sends the permanent owner an invitation; the human chooses their password and enrols their own authenticator. Hosted acceptance uses explicitly disposable customers and records cleanup, API/MCP denial and audit results. Check account-scoped activity includes connection revocations even after the connection/customer is deleted; retained history must omit the deleted customer identity and private content. Never run fixture schemas or recovery scripts against production.

## PWA journey

Read docs/features/pwa.md. Run pnpm test:browser tests/browser/pwa.spec.ts alongside the account/admin journeys after worker, layout or install changes. Check separate manifests and icon dimensions, worker activation and no-store headers, browser install event handling, fallback instructions and focus return. Inspect CacheStorage after signed-in private reading: only offline.html and four icons may be stored. Confirm private requests fail offline, a navigation shows the public reconnect page, and Try again recovers the same address after reconnecting. Check 375px overflow and app-specific icons. Test schemas remain disposable. Never install software into the user's OS as automated acceptance. A simulated install event does not prove physical-device installation.

## Evidence

Preserve browser screenshots in `docs/evidence/browser/`, accessibility results in `docs/evidence/accessibility.json`, and failure screenshots/traces in `test-results/`. Capture a readable report with `pnpm test:browser > docs/evidence/browser-tests.txt 2>&1`.

The export assertion inspects the actual downloaded file for content and collection memberships. API integration tests inspect persisted records and failed foreign-user accesses. MCP tests use the official client over HTTP, and the cross-agent script records actual product-client calls and credential revocation. Do not claim a final screen alone proves persistence or permissions.

Only email/network boundaries are isolated for testing. There are no test-only account or library setters. Fixtures use disposable accounts and schemas. Screenshots and reports must contain no live credentials; never capture the one-time key display in a committed screenshot. Development email captures and private database snapshots stay under ignored `.data/`.

Record the result and evidence paths in `docs/verification.md` and the decision log. A failed or unavailable check remains pending.

## Cleanup

The browser harness stops processes it started and drops its temporary schema. It leaves screenshots and reports intact. It does not stop the developer's usual PostgreSQL instance.

If manually launching verification instances, record their process IDs and stop only those processes. Stop the project-owned PostgreSQL cluster with `./scripts/postgres-local.sh stop` only if this run started it and no other Stash work is using it. Never kill processes by name.

## Helpers

- `./scripts/postgres-local.sh start|stop` manages the project's native local PostgreSQL cluster.
- `pnpm exec tsx scripts/verify-server.ts` launches only the isolated API; SIGTERM cleans up its schema.
- `pnpm exec tsx scripts/clients-check.ts` runs the authenticated real-client acceptance pair.
- `pnpm exec tsx scripts/capacity-check.ts` runs the isolated 10,000-resource baseline.
- `pnpm exec tsx scripts/recovery-check.ts` verifies restore/deletion replay and temporarily restarts the project-owned PostgreSQL cluster. Run it only when other Stash test processes are stopped.

## Verification status

The generated browser recipe has been exercised with real PostgreSQL and Chromium. See `docs/verification.md` for the latest run, discovery checks, and any remaining limits. Hosted email, TLS, backup schedules, and monitoring activation are separate deployment checks.


## Projects journey

Read PROJECTS_IMPLEMENTATION.md and docs/features/projects.md. Run `pnpm exec tsx --test --test-concurrency=1 tests/projects.test.ts` and `pnpm test:browser tests/browser/projects.spec.ts`. Verify project creation, separate main-library search, explicit Include project research, project-scoped note/PDF capture, long documents, edit history, agent append/retry/scopes, excerpt promotion/source links, archive/reopen and private sign-in return. Desktop/mobile recipes include axe and overflow checks. Account JSON roundtrips preserve project metadata, associations and history. Keep Projects browser scenarios in a fresh harness when aggregate account creation would hit real signup-IP limits; do not relax production auth limits. Coordinate shared verification ports with other active Stash chats.

## Draft and restored-file checks

Run tests/browser/drafts.spec.ts and tests/browser/lifecycle.spec.ts in fresh harness batches. Verify actual selection, conflict recovery, draft discard, storage-full warnings, stale-account write rejection and cross-tab sign-out/deletion. Do not weaken signup limits to combine rapid account fixtures. Run tests/storage-journal.test.ts and `node --env-file=.env.local --import tsx scripts/check-file-recovery.ts` after other fixture suites finish. The drill restores only its disposable schema and must track the post-snapshot original as well as snapshot files, replay both journals and remove every original. It must never restart a shared PostgreSQL cluster.

## Hosted acceptance

Use `STASH_HOSTED_ACCEPTANCE=true pnpm exec tsx scripts/check-hosted-library.ts` only for the authorised production release. It creates labelled Resend test recipients, follows actual verification emails privately, checks mixed capture/PDF/summary/MCP/full backup restore, then deletes every disposable account in finally. It never changes production account verification records directly. Direct transfer requests must include the browser Origin. No private email bodies, tokens or client output belong in evidence. `scripts/check-hosted-projects.ts` checks the separately scoped Projects journey with the same explicit flag and cleanup. Confirm physical originals are gone after the ten-minute eligibility delay; account deletion alone is insufficient proof.

For final hosted cleanup, open an owned verification tunnel with `railway connect Postgres --tunnel-only --port 55439`, keeping its credential output private. Run `STASH_HOSTED_ACCEPTANCE=true node --env-file=.env.local --import tsx scripts/check-hosted-cleanup.ts` after cleanup eligibility. It only reads explicitly recorded fixture IDs, durable deletion acknowledgements, summary cost and matching Backblaze versions. It never deletes provider objects itself. Reconnect an expired tunnel rather than changing application behavior. Stop only the tunnel this verification started; leave PostgreSQL and normal app instances running.
