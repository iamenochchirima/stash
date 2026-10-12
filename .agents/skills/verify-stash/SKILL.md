---
name: verify-stash
description: Launch Stash's real web dashboard and PostgreSQL API, drive account and library journeys, and capture screenshots and persisted results. Use after changing Stash user-facing behavior or preparing a release.
---

# Verify Stash

The canonical feature map is [docs/features/README.md](../../../docs/features/README.md). The first-release requirements remain in [IMPLEMENTATION.md](../../../IMPLEMENTATION.md); the feature map describes current behavior.

## Launch

From the repository root, run `pnpm install --frozen-lockfile`, `./scripts/postgres-local.sh start`, and `pnpm exec playwright install chromium`. Set `TEST_DATABASE_URL` if using an existing PostgreSQL test database. Its name must end in `_test`.

Run `pnpm test:browser`. The harness uses `.next-verification` for isolated Next.js output so it can run alongside the local review server. It launches an API on `127.0.0.1:4100` with a disposable PostgreSQL schema and a Next.js dashboard on `127.0.0.1:3100`. Development emails are captured in private `.data/verification-mail` files, never sent. This suite starts and cleans up its own instances; do not launch another suite on those ports simultaneously.

For normal manual use, run `pnpm db:migrate` then `pnpm dev` and open `http://127.0.0.1:3000`. Manual instances use the development library, so automated checks should use the isolated harness instead.

## Doctor

Before driving a manually running instance, check `GET /health` for version `0.1.0` and `GET /ready` for status 200 on its API port. Confirm the ports belong to this run and the configured `WEB_ORIGIN` matches the browser URL. If the harness says a port is occupied, stop and identify its owner; never reuse or kill an unknown process.

For the managed browser suite, Playwright checks the two readiness URLs before driving. If readiness fails, inspect `docs/evidence/browser-tests.txt` or the server output before trying UI actions.

## Drive

`tests/browser/journeys.spec.ts` is the canonical browser recipe. It uses stable accessible selectors such as `Sign up`, `Your name`, `Email address`, `Password`, `Create account`, `Save a resource`, `Link`, `Title`, `Why it matters`, `Search your library`, `Import / export`, and `Open profile`.

Start at the public landing page, follow Sign up to `/signup`, and use `/signin` for returning users. The public page has a 13-second illustrated agent-save demo without a visible playback bar, chapter tabs, or caption. Check automatic start and looping, offscreen pause/resume, manual pause persistence, actual typing, a pause control revealed on hover or keyboard focus, example confirmation, card movement, and reduced motion with tests/browser/demo.spec.ts. Drive the actual user path: create an account, save a resource, follow the locally captured verification email, edit collections and reading status, search, import/export, manage an agent key, update the profile, sign out/in, and delete the account with reauthentication. The recovery test requests and follows a real captured email, then rejects a reused link. Mobile tests drive saving and keyboard dialogs at 375 and 768 pixels; the desktop test uses 1440 pixels.

`tests/browser/accessibility.spec.ts` checks signup, library, save dialog, and profile using axe. Keyboard focus, Escape, dialog focus return, and layout overflow have dedicated browser assertions.

`pnpm test` covers PostgreSQL-backed account, ownership, library, import/export, and MCP behavior. `pnpm exec tsx scripts/clients-check.ts` verifies real Codex/OpenCode clients only where both have functioning model access. Never substitute an SDK test for that actual client acceptance.

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
