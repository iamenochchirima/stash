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

Read LIBRARY_V2_IMPLEMENTATION.md and docs/features/library-v2.md. Run pnpm test:browser tests/browser/item-detail.spec.ts tests/browser/items.spec.ts tests/browser/journeys.spec.ts tests/browser/accessibility.spec.ts for the mixed-item consumer foundation. Check card-body/title navigation, separate source/edit controls, direct links after sign-in, foreign-account rejection, full content, Markdown safety, favourites, archive, Trash/restore, filter/back navigation, mobile overflow and persisted edits. Tests/items*.test.ts cover migration, ownership, request identity, revision conflicts, lifecycle and JSON v2 round-trip. tests/mcp.test.ts covers two-client notes/ideas and legacy link compatibility. PDF/AI checks remain pending until their stages are implemented; do not claim hosted storage/provider acceptance from the local foundation.

## Admin journey

Read [ADMIN_IMPLEMENTATION.md](../../../ADMIN_IMPLEMENTATION.md) and [docs/features/admin.md](../../../docs/features/admin.md). Run pnpm test:browser tests/browser/admin.spec.ts for the focused owner/operator/viewer journey. The harness bootstraps a synthetic owner into its private captured mailbox and generates a disposable encryption key. It drives real invitation enrolment, password/TOTP authentication, one-time recovery codes, 7/30-day metrics, query-only pagination, filtered user detail/back navigation, suspension/restoration with API/MCP denial, audit, owner deletion, authenticator replacement, viewer/operator enrolment, operator suspension/restoration, and owner-only denial. It cleans up customer fixtures through real deletion endpoints.

Admin enrolment, MFA replacement and recovery-code screens contain credentials. Traces and automatic failure screenshots are disabled for this test. Never capture a live invitation URL, QR, setup key or recovery codes. Safe metadata screenshots go under docs/evidence/admin. Check mobile overflow and axe, native dialog focus and labels. Admin integration tests in tests/admin.test.ts cover permission boundaries, expiry/replay, races, provider failures, durable deletion, retention and origin aliases against disposable PostgreSQL schemas.

Run pnpm exec tsx scripts/admin-capacity-check.ts separately for paginated aggregate/index evidence. Run the recovery drill only after other Stash tests stop. Production bootstrap sends the permanent owner an invitation; the human chooses their password and enrols their own authenticator. Hosted acceptance uses explicitly disposable customers and records cleanup, API/MCP denial and audit results. Check account-scoped activity includes connection revocations even after the connection/customer is deleted; retained history must omit the deleted customer identity and private content. Never run fixture schemas or recovery scripts against production.

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
