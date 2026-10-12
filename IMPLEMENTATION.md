# Stash implementation and verification plan

Stash will give each user a private research library that they can manage through the web dashboard and access through supported AI agents. The first release must take a new user from signup to saving a resource and retrieving it through an agent, with reliable account recovery and control over their data.

This is the working checklist for implementation, verification, and release. It extends [the original architecture](arch.md). Where the original MVP assumes one user or API keys alone, this plan adds browser accounts, profiles, onboarding, and isolation between users.

## Status and completion rules

Created on 12 October 2026. The first release scope follows the plan accepted in this chat. Implementation started at the user's request. The scope correction below defers hosted activation while preserving local verification and a reviewable project. PostgreSQL is required for development and production. Hosting and business email setup are deferred at the user's request; prepare the project and local evidence first.

An initial scaffold exists under `apps/` and `packages/`, including account, profile, library, collection, and MCP code. Treat it as unfinished until reviewed and tested. No existing scaffold feature counts as complete merely because its files exist. The dashboard, API/MCP, and PostgreSQL were subsequently deployed at the user’s request on 12 October 2026. Email features are explicitly disabled; hosted backup schedules and external alerts remain pending.

- Leave an implementation box unchecked until the behavior works, its acceptance criteria pass, and its evidence is recorded.
- Leave a verification box unchecked until the check has actually run against the relevant revision and environment.
- A skipped, blocked, or unavailable check is not a pass. Record the reason and the next action in the evidence log.
- Use the requirement and test IDs below to connect changes to their proof.
- Record defects when discovered, fix them, and rerun the affected checks. Repeat broader checks when the defect could affect other features.
- Scope changes require an explicit recorded decision. Do not silently drop a requirement to finish the checklist.
- Future features are tracked separately and do not block the first release.
- Prepare a reviewable release before requesting public deployment approval. Deployment still requires that separate approval.

## Scope correction from the user

During implementation, the user required PostgreSQL, confirmed no current domain or sender, and asked to focus on building rather than hosting. The unavailable Claude client was replaced with Hermes or OpenCode; Codex/OpenCode passed real acceptance. Hosted SMTP delivery, domains/TLS, paid provisioning, remote CI execution, backup schedules, monitoring activation, and actual hosting costs are deferred to public launch. R06 to R10 cover project preparation and local recovery proof under that correction. These hosted checks are not claimed as completed by local tests.

The user subsequently authorized Railway backends and a Vercel client, and explicitly chose deployment with email features disabled. Platform domains and HTTPS are active. See docs/operations.md and docs/evidence/hosted-deployment.json. This supersedes the earlier hosting deferral for those services.

## Release scope and decisions

### First release

Accounts, private profiles, guided onboarding, private resource libraries, collections and tags, reading status, duplicate handling, search, agent credentials and MCP access, bookmark import/export, account deletion, safe metadata extraction, and launch preparation.

### Architecture

| Area | Planned approach |
| --- | --- |
| Application | TypeScript monorepo managed with pnpm |
| Web dashboard | Next.js with the existing Stash brand assets; reconcile the current CSS scaffold with the original Tailwind plan |
| Backend | Fastify for browser API and remote MCP |
| Shared behavior | Core library services used by both API and MCP |
| Production database | PostgreSQL with Drizzle and versioned migrations |
| Local development | PostgreSQL locally and in production; isolated PostgreSQL databases for tests |
| Browser authentication | Email/password accounts with server-side sessions, verification, and recovery |
| Agent authentication | Individually revocable scoped keys for clients supporting bearer authentication; verify OAuth requirements before advertising other clients |
| Hosting | Railway from the original architecture, subject to configuration and release review |
| Search | PostgreSQL full-text search and tag filters; semantic search belongs to a later release |

### Decisions to settle before dependent implementation

- [x] D01 Review the existing scaffold and record which parts to retain, replace, or remove.
- [x] D02 Select the email delivery service, sender domain, and development email capture method. Document required configuration without committing secrets.
- [x] D03 Confirm the first supported agent clients, their authentication requirements, and a real cross-agent acceptance pair. The user selected Codex, then replaced unavailable Claude with Hermes or OpenCode. Verify actual tool calls before claiming support.
- [x] D04 Decide whether OAuth is required for that initial client set. If required, implement and test authorization, consent, token expiry, and revocation before claiming compatibility.
- [x] D05 Preserve the original many-to-many collection model unless a simpler one-collection-per-resource model is explicitly accepted. The current scaffold uses one collection per resource and needs reconciliation.
- [x] D06 Choose avatar storage, upload size limits, and allowed image types. Keep generated initials as the fallback.
- [x] D07 Define session lifetime, verification/reset token lifetime, resource limits, import limits, and metadata fetch limits. Record the values in configuration and tests.
- [x] D08 Record the user's hosting deferral and prepare PostgreSQL/Railway, backup, journal, and cost-configuration requirements. Confirm actual domains, sender, and budget before later paid provisioning.
- [x] D09 Record the styling choice and reconcile `arch.md` with the final implementation. Update setup and architecture documentation to match the actual code.

## Phase 1 Foundation and data model

- [x] F01 Review dependencies, package scripts, TypeScript configuration, and the current scaffold. Fix install, type, and runtime errors.
- [x] F02 Provide documented commands for local startup, type checking, tests, production build, and database migration.
- [x] F03 Separate browser routes, authentication, MCP transport, database access, and shared library services into maintainable modules.
- [x] F04 Add versioned migrations for users, sessions, verification/reset tokens, resources, collections, collection memberships, and agent credentials.
- [x] F05 Add foreign keys, ownership constraints, unique normalized resource URLs per user, and indexes for listing and search.
- [x] F06 Keep migration execution separate from ordinary request handling. Verify clean installation and upgrades without data loss.
- [x] F07 Make local data persist across restarts. Keep local files, credentials, and build output out of version control.
- [x] F08 Validate configuration at startup and fail with actionable messages when required settings are missing.
- [x] F09 Use bounded pagination, input validation, consistent API errors, and safe logging.
- [x] F10 Add CI checks using the committed lockfile, an isolated test database, and no live user data.

Acceptance: A fresh checkout starts using documented steps. A real PostgreSQL database can be initialized and migrated. Existing user data survives an application restart and a supported schema upgrade.

Verification: T01, T02, T03, T19.

## Phase 2 Accounts and private profiles

- [x] A01 Implement signup with normalized email addresses, password requirements, duplicate account handling, and clear validation errors.
- [x] A02 Store salted password hashes using an appropriate password derivation method. Keep passwords and tokens out of logs and responses.
- [x] A03 Send verification emails and handle valid, expired, reused, and invalid verification links. Define which actions unverified accounts can perform.
- [x] A04 Implement login, logout, session expiry, and server-side session invalidation. Use secure cookie settings in production.
- [x] A05 Implement password recovery with generic public responses, bounded requests, expiring single-use tokens, and session invalidation after a reset.
- [x] A06 Protect authentication and email endpoints against repeated attempts. Validate browser origins and protect state-changing browser requests against CSRF.
- [x] A07 Let users edit their name, bio, avatar, and research interests. Keep email changes out of the editable profile until a verified email-change flow exists.
- [x] A08 Validate avatar type, size, and content; reject unsafe uploads and remove replaced/deleted assets according to the storage policy.
- [x] A09 Enforce ownership in every resource, collection, credential, export, and account route. Derive the acting user from authentication rather than request fields.
- [x] A10 Implement account deletion with recent reauthentication and a clear confirmation explaining the consequences. Delete owned data and invalidate sessions and agent credentials.
- [x] A11 Explain backup retention and how deleted accounts remain inaccessible while retained backups expire.

Acceptance: Two users can independently sign up and recover their accounts. Each sees and changes only their own data. Profile edits survive refresh and restart. Deleted accounts lose browser and agent access immediately.

Verification: T04, T05, T06, T07, T08, T17.

## Phase 3 Guided onboarding

- [x] O01 Present a new-user checklist covering profile creation, first save, collection organization, agent connection, and successful agent retrieval.
- [x] O02 Let users skip agent setup and start using the dashboard immediately.
- [x] O03 Link each step to the corresponding action and explain what the user will accomplish.
- [x] O04 Derive completion from real persisted actions. Creating a credential alone must not count as a successful connection or retrieval.
- [x] O05 Preserve setup progress across refresh, logout, and another device. Define whether completed milestones stay complete after deleting the first resource or revoking a key.
- [x] O06 Provide useful empty states without inserting sample resources into a user's real library.
- [x] O07 Explain unsupported client authentication and show a working alternative only when it has been verified.

Acceptance: A new user can save and organize a resource without configuring an agent. An authenticated agent request and successful resource retrieval complete the appropriate setup milestones.

Verification: T09, T14, T15, T16.

## Phase 4 Personal research library

- [x] L01 Save HTTP/HTTPS links with titles, notes, tags, timestamps, and source-agent attribution.
- [x] L02 Edit resource details and reading status. Define URL editing behavior and duplicate handling if URLs can be changed.
- [x] L03 Delete resources with a clear confirmation and update the dashboard after success.
- [x] L04 Create, rename, and delete collections. Deleting a collection must preserve resources and remove its memberships.
- [x] L05 Add and remove collection memberships according to D05. Reject foreign collection IDs even when a user knows their UUID.
- [x] L06 Normalize URLs consistently, remove agreed tracking parameters, and define fragment/trailing-slash handling without merging distinct resources accidentally.
- [x] L07 Detect duplicates within a user's library, including concurrent saves. Return the existing resource without silently replacing notes or tags. Allow different users to save the same URL independently.
- [x] L08 Add full-text search, tag matching, collection filters, and unread/reading/finished filters.
- [x] L09 Provide deterministic pagination, accurate filtered counts, and consistent empty results.
- [x] L10 Prevent older search responses from replacing newer results. Provide retry paths for failed requests.
- [x] L11 Extract titles and basic metadata with strict timeouts, response-size limits, redirect limits, and safe URL fetching. Keep manual save available when extraction fails.
- [x] L12 Block metadata requests to loopback, private, link-local, and cloud metadata addresses, including IPv6, redirects, and DNS resolution changes. Sanitize extracted content.
- [x] L13 Display source and metadata accurately. Treat notes and external content as untrusted data, including in responses to agents.
- [x] L14 Finish responsive layouts, loading states, form validation, error messages, keyboard controls, and accessible dialogs.

Acceptance: A user can save, find, organize, edit, and delete a resource. Duplicate saves preserve existing context. Search and filters return only that user's matching resources. A failed metadata fetch never prevents manual saving.

Verification: T07, T10, T11, T12, T15, T16, T18.

## Phase 5 Agent connections and MCP

- [x] M01 Expose the remote MCP endpoint using Streamable HTTP and verify protocol initialization, tool discovery, and tool calls with the official SDK.
- [x] M02 Implement `save_resource`, `search_resources`, `get_resource`, `list_resources`, and `delete_resource` through the shared library services.
- [x] M03 Add `list_collections` so agents can resolve collection names and IDs. Decide whether agents need a collection-creation tool for the first release.
- [x] M04 Create named credentials per agent with read-only or read/write access. Read/write access includes deletion and must say so clearly.
- [x] M05 Show new credentials once, store only a cryptographic digest, redact credentials from logs, and provide immediate revocation.
- [x] M06 Enforce permission checks during tool execution as well as discovery. Read-only credentials must never save, edit, or delete data.
- [x] M07 Reject missing, malformed, invalid, revoked, and foreign-user credentials. Validate allowed origins and hosts for remote access.
- [x] M08 Track actual credential use and successful retrieval for onboarding. Distinguish key creation, connection, and verified retrieval in the UI.
- [x] M09 Provide actionable protocol/tool errors without leaking stack traces, database details, or other users' records.
- [x] M10 Document verified setup instructions per supported client, including endpoint, authentication, permissions, and troubleshooting.
- [x] M11 Test saving in one real supported client and retrieving the same resource in another. Record client versions and account restrictions.
- [x] M12 Record OAuth applicability under D04. OAuth is not required for the verified Codex/OpenCode bearer-token pair; do not claim OAuth-only client support.

Acceptance: Supported agents use the same private data as the dashboard. A read-only agent can retrieve but cannot write. Revocation stops new requests. Two real supported clients complete the cross-agent save/retrieve journey.

Verification: T07, T13, T14, T17.

## Phase 6 Import and export

- [x] P01 Support bookmark HTML import and a versioned Stash JSON format. Publish examples and the expected fields.
- [x] P02 Validate size, item count, encoding, schema, URL scheme, notes, tags, and collections before writing.
- [x] P03 Preview the import, show duplicate/invalid counts, and require the user to start the write. Document atomic or partial import behavior.
- [x] P04 Reuse normal ownership, URL normalization, duplicate, and collection rules. Ignore or remap source IDs and never trust imported ownership fields.
- [x] P05 Show a final report of saved, duplicate, and rejected items. Retrying must not duplicate resources or overwrite notes silently.
- [x] P06 Export all resources, notes, tags, reading status, collection memberships, and relevant profile details using pagination or streaming as needed. Exclude passwords, credential digests, sessions, and tokens.
- [x] P07 Verify a complete export/import round trip into a fresh test account, preserving content while remapping IDs.

Acceptance: Users can bring in existing bookmarks and take their full library away. A round trip preserves organization and content, and cannot expose or modify another user's data.

Verification: T07, T17, T20.

## Verification and test matrix

Automated checks use isolated fixtures and include successful behavior, invalid input, and authorization failures. Browser checks drive the real running app. Protocol tests use an MCP client, followed by real product-client checks. Local database results do not replace PostgreSQL release checks.

| ID | Check | Method and required outcome |
| --- | --- | --- |
| T01 | Repository checks | Clean dependency install, type checking, production builds for web and server, and a production server startup smoke test. Commands must exist and pass. |
| T02 | Database migrations | Integration tests on real PostgreSQL for a fresh database, repeated migration invocation, supported upgrade, and existing-data preservation. Verify constraints and rollback/recovery instructions. |
| T03 | Persistence | Save records, stop/start the application and database, and verify users, collections, resources, credentials, and onboarding progress persist. |
| T04 | Signup and verification | Integration and browser tests for valid signup, normalized email, duplicate email, invalid/oversized fields, weak password, email delivery, and valid/expired/reused/invalid verification tokens. Confirm unverified-account policy. |
| T05 | Login and sessions | Correct/incorrect credentials, unknown email, persistent login, logout, expired/deleted session, production cookie flags, and rate-limit responses. Browser logout must block subsequent authenticated requests. |
| T06 | Password recovery | Known/unknown email use equivalent public responses. Verify mail delivery, expiry, single use, changed password, rejection of the old password, and prior-session invalidation. |
| T07 | User isolation | Create users A and B with overlapping URLs and similarly named collections. As A, attempt B's get/list/search/update/delete, collection assignments and management, key management, import/export, and account operations through every exposed API/MCP path. All attempts must fail without leaks or mutation. |
| T08 | Profiles and avatars | Save and reload profile changes; test boundaries and invalid fields. Accept safe supported images, reject oversized/mislabelled/unsafe files, verify cleanup and ownership. |
| T09 | Onboarding | Fresh account, optional steps, skip agent setup, first save, collection organization, first authenticated agent request, successful retrieval, refresh, logout/login, and milestone deletion/revocation behavior. |
| T10 | Resource and collection behavior | Create/edit/delete resources and collections, membership changes, reading statuses, tag normalization, invalid URLs, foreign collection IDs, and preservation of resources after collection deletion. Exercise real database services through API and MCP. |
| T11 | Duplicate handling | Unit tests for agreed URL normalization boundaries; database tests for sequential and concurrent duplicate saves, preserved notes, distinct URLs, and identical URLs saved by different users. |
| T12 | Search and pagination | Known fixtures for titles, notes, URLs, tags, case handling, empty/nonmatching terms, combined filters, page boundaries, stable ordering, and counts. Browser test for a slow older response arriving after a newer query. |
| T13 | MCP protocol and permissions | SDK client initialization, tools/list, tools/call, invalid arguments, pagination, error responses, unknown IDs, unsupported methods, read/write scopes, missing/invalid/revoked keys, and transport cleanup. Direct unauthorized tool calls must fail. |
| T14 | Real client compatibility | Record setup and actual execution in each supported client. Save a repository with notes and a collection in client A, retrieve it in client B, confirm it in the dashboard, and verify revocation. Run OAuth cases where applicable. |
| T15 | Browser journeys | Real browser tests for signup/login, onboarding, save/edit/delete, search/filter, collection management, profile editing, key creation/copy/revocation, import/export, and failure/retry states. Record screenshots of key screens and any defects. |
| T16 | Accessibility and layout | Keyboard-only navigation, visible focus, modal focus trapping/return, Escape behavior, input labels, screen-reader names, status announcements, contrast, reduced motion, and layouts at 375, 768, and 1440 pixels. Include long titles, many tags, and empty/error states. |
| T17 | Security and deletion | CSRF/origin checks, host validation, malformed bodies, upload validation, rate limits, secrets excluded from logs and exports, reauthentication for deletion, owned-data cleanup, session/key invalidation, and remaining access attempts after deletion. |
| T18 | External metadata | Controlled local test fixtures simulate safe pages, slow/oversized responses, invalid content, redirects, private IPv4/IPv6 targets, DNS changes, and extraction failures. No private network fetch succeeds; manual save still works. |
| T19 | Deployment readiness | Production configuration, HTTPS settings, health/readiness checks, database connectivity, migration procedure, graceful shutdown, backup/restore drill, rollback procedure, and secret handling. Run hosted smoke checks after deployment is approved. |
| T20 | Portability | Valid bookmark HTML and versioned JSON; malformed/oversized imports; invalid schemes; duplicate retries; collection remapping; full exports exceeding one page; malicious ownership fields; and export/import round trips. |
| T21 | Capacity and failure behavior | Record a baseline using 10,000 resources in one account, 100 collections, and 10 concurrent clients. Measure listing/search/save latency, memory, and errors on a named environment. Choose and record local engineering acceptance targets before the final evaluation; test database failure and metadata timeouts without data corruption. |

### Required end-to-end acceptance scenarios

- [x] E01 A new user signs up, verifies their email, edits their profile, saves a repository, creates a collection, and finds the repository through search.
- [x] E02 The user creates a write-enabled agent connection, saves an article through a supported agent, and retrieves it through a second supported agent.
- [x] E03 A read-only agent retrieves resources but cannot save or delete them. Revoking its credential prevents subsequent requests.
- [x] E04 A second user can save the same links independently and cannot see or change the first user's resources, collections, profile, credentials, or exports.
- [x] E05 A returning user recovers their password and regains access to their original library; invalid and reused recovery links fail.
- [x] E06 A user imports bookmarks, sees accurate duplicate/rejection reporting, exports the complete library, and restores it into a fresh test account.
- [x] E07 A user completes the save/find flow on mobile and with keyboard-only navigation, including dialogs and validation errors.
- [x] E08 Account deletion removes owned live data and invalidates browser sessions and agent access. Backup retention follows the documented policy.

## Phase 7 Launch preparation

- [x] R01 Write a README with setup, configuration, architecture, migration, test, and supported-client instructions.
- [x] R02 Complete the test matrix and end-to-end scenarios. Record exact commands, results, revision, environment, and evidence locations.
- [x] R03 Fix release-blocking defects, including data leaks, lost data, broken recovery, permission bypasses, failed core journeys, and inaccessible primary controls.
- [x] R04 Review dependency and secret scans. Resolve findings or document specific accepted risks with justification.
- [x] R05 Define service health and database readiness checks, structured error logging, and monitoring alerts. Exclude private notes and credentials from telemetry.
- [x] R06 Prepare production configuration and migration/deployment steps. Document operator/application access boundaries; actual host access setup is deferred.
- [x] R07 Prepare backup/retention and independent deletion-journal requirements and complete a local dump/restore drill in an isolated schema. Actual hosted backup configuration is deferred to launch.
- [x] R08 Prepare schema-aware rollback and demonstrate local snapshot recovery with deletion replay. A live traffic switch and previous deployed-artifact rollback are deferred to launch.
- [x] R09 Record privacy behavior, account deletion, backup retention, data export, agent permissions, and supported-client limits in user-facing help.
- [x] R10 Present the deployable project, local evidence, and remaining launch gates for review. Actual Railway and sender costs are deferred at the user's request.
- [x] R11 Obtain explicit approval for public deployment before publishing or provisioning paid production services.
- [ ] R12 After approval, deploy the database, backend, and dashboard with HTTPS and configured domains. Run hosted E01 through E08 using disposable test accounts.
- [ ] R13 Confirm hosted monitoring and backups, remove disposable test data, and record the release version and any accepted limitations.

R12 is partially verified: hosted signup/sign-in, saving and reload persistence, MCP SDK save/retrieve, scopes/revocation, origin rejection, and disposable account deletion passed. Email recovery is disabled by the user’s decision. Hosted real-client acceptance, hosted restore, and the remaining full E01–E08 coverage are not claimed. R13 remains pending: readiness checks and persistent volumes are configured, but Railway backup scheduling requires a Pro workspace and external alert notifications are not configured.

## Future feature backlog

Future features are tracked separately in [the Stash feature backlog](FEATURE_BACKLOG.md). They are outside this first release checklist.

## Evidence log and defect tracking

Add one row per meaningful test run or manual acceptance check. Link to committed test files, saved screenshots, reports, or client transcripts where appropriate. Do not include credentials or private user data in evidence.

| Date | Requirement or test IDs | Revision and environment | Command or procedure | Result | Evidence location or defect |
| --- | --- | --- | --- | --- | --- |
| 12 October 2026 | Planning baseline | Local working tree | Inspect architecture and scaffold; create implementation checklist | Plan created; application verification pending | `IMPLEMENTATION.md` |

| 12 October 2026 | First-release implementation and local verification | Final working tree fingerprint | Install, type checks, 22 backend tests, 6 browser tests, builds, real clients, restore/restart, capacity, dependency audit | Passed locally; hosted gates deferred | `docs/verification.md`, `docs/evidence/`, `docs/decisions.tsv` |

For each defect, record its ID, affected requirements, reproduction steps, expected/actual behavior, severity, fix location, and successful retest. Keep blocked checks visible with the condition required to unblock them.

## Final completion checklist

### Implementation complete

See [the final verification report](docs/verification.md) for evidence, applicability, scope corrections, and remaining hosted checks.

- [x] D01 through D09 have recorded decisions, including how conditional OAuth work is handled.
- [x] F01 through F10, A01 through A11, O01 through O07, L01 through L14, M01 through M12, and P01 through P07 are complete under those decisions.
- [x] T01 through T21 have passing evidence for the relevant release revision. Conditional checks have explicit applicability decisions rather than silent omissions.
- [x] E01 through E08 pass against the release candidate.
- [x] R01 through R10 are complete, and no release-blocking defects remain.
- [x] Documentation matches the final schema, authentication, UI, commands, and verified client support.
- [x] The handoff identifies implemented behavior, proof, unresolved limits, future scope, and deployment status accurately.

### Public release complete

- [x] R11 records public deployment approval.
- [ ] R12 and R13 are complete with hosted acceptance evidence, monitoring, and backup confirmation.

Application implementation can be complete before public deployment. Do not claim the public release is complete until its separate checklist passes.
