# Stash first release verification

The first-release project is implemented and locally verified with PostgreSQL. Public deployment, real business email configuration, domains, hosted backup schedules, monitoring activation, and hosting costs were explicitly deferred by the user. They remain launch gates rather than completed hosted checks.

## Environment and scope

Verification ran on 12 October 2026 using Node.js 23.11.1, PostgreSQL 18.6, pnpm 10.30.1, Next.js 16.4.0, and Chromium through Playwright 1.64.0. The documented deployment target is Node.js 24 LTS. CI configuration targets Node 24 but has not run remotely in this session.

Tests use a dedicated `stash_test` database and disposable schemas. The normal development database is separate. Email checks used private file capture and a local SMTP server; no messages were sent to real users. Real agent checks used disposable credentials and the clients' existing model access.

The exact final source digest is recorded in `evidence/source-fingerprint.json`. Results refer to the working tree captured there; no remote repository or hosted release was created.

## Results and reproducible checks

| Check | Result and evidence |
| --- | --- |
| Lockfile installation | `pnpm install --frozen-lockfile` passed. [Install report](evidence/install.txt). |
| Type checks | `pnpm typecheck` passed across shared schemas, database, core, server, and dashboard. [Report](evidence/typecheck.txt). |
| Backend tests | 22 tests passed with no skips, using real PostgreSQL. Account verification/recovery, sessions, avatars, deletion, isolation, migrations, concurrency, library/search, MCP, metadata boundaries, and portability are covered. [Report](evidence/backend-tests.txt), [test sources](../tests/). |
| Browser paths | 6 tests passed: full account/library/import/export/key/deletion journey, recovery, mobile keyboard paths at 375 and 768 pixels, accessibility, and out-of-order search responses. Desktop checks run at 1440 pixels. [Report](evidence/browser-tests.txt), [screenshots](evidence/browser/). |
| Accessibility | Zero axe WCAG A/AA violations on signup, library, save dialog, and profile. Keyboard focus/trapping/return, Escape, and width overflow also have assertions. This is automated/browser evidence, not a claim of a full human screen-reader audit. [Report](evidence/accessibility.json). |
| Real agent pair | Codex CLI 0.162.1 saved a repository with exact notes and Inbox membership; OpenCode 1.18.35 retrieved it. Revocation returned 401. [Acceptance report](evidence/client-acceptance.json), [Codex output](evidence/codex-client.txt), [OpenCode output](evidence/opencode-client.txt). |
| Production output | Web and server builds pass. The built server starts using production configuration and shuts down cleanly. [Build report](evidence/build.txt), [runtime report](evidence/production-smoke.txt). |
| Persistence and recovery | Project-owned PostgreSQL was stopped/restarted. Sessions, profiles/onboarding, resources/memberships, and keys persisted. Readiness returned 503 during the outage and 200 after recovery. A real dump/restore reinstated a deleted account; journal replay removed it and dependent data. [Report](evidence/recovery.json), [drill](../scripts/recovery-check.ts). |
| Capacity | 10,000 resources, 100 collections, 10 concurrent clients; zero errors. Listing/search/duplicate saves passed the preselected local p95 <= 1,000 ms target, and resource quota rejection passed. [Measurements](evidence/capacity.json). These are local measurements, not hosted promises. |
| Dependency audit | Production dependency audit reports zero advisories after updating mail/image dependencies. [Report](evidence/dependency-audit.json). |
| Evidence secret scan | Saved reports and screenshots contain synthetic test data, not full keys, session cookies, or recovery tokens. [Scan](evidence/secret-scan.json). Private outboxes, snapshots, and journals remain under ignored `.data/`. |
| Harness cleanup | Explicit Playwright global teardown drops the run's schema, removes the schema registry, and leaves evidence intact. API/dashboard processes stop and their ports become free. [Report](evidence/browser-cleanup.json). |

## Requirement coverage

| Requirements | Evidence |
| --- | --- |
| D01 to D09 | [Recorded decisions](decisions.md), user scope/client corrections, and [checkpoint trail](decisions.tsv). |
| F01 to F10 | Install/type/build reports, PostgreSQL migrations and tests, documented commands, and the CI workflow. CI definition is present; remote CI execution is deferred until repository publication. |
| A01 to A11 | Account integration/browser tests, scoped ownership tests, sanitized avatar tests, secure cookie tests, locked reauthentication, and restore/deletion replay. Production retention configuration remains a hosting gate. |
| O01 to O07 | Persisted onboarding fields, browser setup journey, actual MCP use/retrieval, private empty states, and client-support help. |
| L01 to L14 | Library/isolation/search/concurrency/metadata tests, browser journeys, accessibility report, and resource source/metadata display. |
| M01 to M12 | SDK protocol tests plus real Codex/OpenCode calls and revocation. M12 OAuth is explicitly inapplicable to this verified bearer-token pair; OAuth-only clients are not claimed. |
| P01 to P07 | HTML/JSON validation, preview-before-write, partial reports with original indexes, empty collections, complete export beyond a page, ID remapping, and round-trip tests. |
| E01 to E08 | Browser signup/library/profile, real cross-agent, read-only/revocation, two-user isolation, recovery, import/export, mobile/keyboard, and account deletion/recovery tests respectively. |
| T01 to T21 | Test matrix in IMPLEMENTATION.md maps to the reports above. T19 hosted checks and live business email delivery are deferred; local production/recovery preparation passed. |
| R01 to R10 | Setup/architecture/agent/help/operation documentation, local proof, fixed review findings, source/evidence audit, and the reviewable project. Hosted activation parts are launch gates per the user's scope correction. |

## Review findings and repairs

An independent agent reviewed the implementation and evidence. Findings led to these fixes:

- Revalidate password hashes under a user-row lock before issuing login sessions or deleting accounts, preventing concurrent reset races.
- Include DNS in the total metadata deadline and pin connections to validated public addresses.
- Preserve empty collections during imports and report original file indexes after invalid entries.
- Commit each imported resource with its metadata and timestamps atomically.
- Export from a repeatable-read database snapshot so concurrent writes cannot shift pages.
- Keep deletion intents outside restored database snapshots and replay them before traffic.

A fresh agent discovered the verification skill through `AGENTS.md`, followed it, inspected screenshots, and found that process-group shutdown could leave a disposable browser schema. Explicit global teardown fixed that defect and the fresh agent confirmed cleanup. The same review caught a screenshot captured before resource loading finished; the recipe now waits for both saved cards before taking the screenshot.

The primary agent performed an evidence audit of saved outputs, current files, and the decision trail. No inaccessible transcript or cross-model audit is claimed. Earlier manually entered decision-log timestamps were explicitly superseded by an automatically stamped correction row.

## Remaining deployment gates

No live sender/domain/host was chosen, no paid resource was provisioned, and no public deployment occurred. Before public launch, configure business SMTP, HTTPS origins, PostgreSQL, persistent independent journal storage, backup retention, restore access, monitoring alerts, and costs. Obtain deployment approval and rerun hosted acceptance. Multiple backend replicas require shared journal storage; separate per-instance journals are unsupported.

Hermes and Claude were not verified. Claude's account was unavailable; the user selected OpenCode instead. The verified pair is Codex/OpenCode. Future backlog features remain separate.

## Password length follow-up

At the user's request, signup and password recovery now require at least 8 characters. A focused PostgreSQL-backed test verifies that signup, login, and recovery accept 8 characters and signup/recovery reject 7. See [the focused report](evidence/password-length-tests.txt). The browser account journeys use 8-character signup and reset passwords. Type checks and the production build are rerun for this change; the original 22-test baseline above remains the first-release record.

## Hosted deployment, 12 October 2026

The user authorized Railway backends and Vercel dashboard deployment, then selected email disabled. PostgreSQL 18 and the API/MCP backend are in Railway project Stash; the dashboard is https://stash-tau-seven.vercel.app. Both use platform HTTPS domains. The backend has a separate persistent deletion-journal volume and a single replica. Runtime migrations run before server startup. `/ready` is configured as the deployment health check.

`pnpm test` passed 24 PostgreSQL-backed tests with no skips, including disabled-email signup and key issuance. `pnpm test:browser` passed all 6 browser tests with the default email-enabled local capture mode. `pnpm typecheck` passed. A focused production configuration test passed with EMAIL_DISABLED=true and no SMTP, and rejects missing SMTP when email is enabled. See [backend](evidence/deployment-backend-tests.txt), [browser](evidence/deployment-browser-tests.txt), [type checks](evidence/deployment-typecheck.txt), and [configuration](evidence/deployment-config-tests.txt).

A real Chromium browser exercised the public Vercel URL: eight-character signup, saving, reload persistence, sign out/in, and secure HttpOnly session cookies. Two independent MCP SDK clients exercised the public Railway endpoint: writer save, reader retrieval, read scope, and immediate revocation. Wrong-origin mutation returned 403 and disabled password recovery returned 503. The disposable account was deleted and its session returned 401. See [sanitized hosted results](evidence/hosted-deployment.json) and [hosted library screenshot](evidence/browser/hosted-library.png). This is SDK protocol proof; the earlier actual Codex/OpenCode acceptance remains local.

Railway rejected automatic volume backups with “Manual backups and backup schedules are only available for Pro workspaces.” No plan upgrade was performed. PITR is disabled. External alerts, hosted snapshot/restore, hosted actual-client acceptance, and business SMTP remain pending. Deployment success does not mark those checks as passed. Email re-enablement restores verification requirements for keys and MCP; users are not falsely marked verified while email is disabled.

The final deployed artifacts are Railway `4560b434-5bc1-40ad-88d0-c2afb3f86262` (SUCCESS) and Vercel `dpl_2KPwAw9S6C6SWJ7jh1eS1dQ6511Y` (READY). The Vercel CLI temporarily failed to confirm status; a separate inspect confirmed READY and the production alias. Hosted checks were rerun successfully against these final artifacts. [Resource summary](evidence/deployment-resources.json).
