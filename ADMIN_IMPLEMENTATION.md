# Stash admin implementation plan

Approved for implementation on 14 October 2026. The user requested a goal and implementation to completion. The admin client extends the deployed service without changing the completed consumer release checklist in IMPLEMENTATION.md. FEATURE_BACKLOG.md remains separate.

## Outcome

An administrator can see whether Stash is working, find a user, understand their account and connection status, and take a specific support action. Every administrative change has an actor, reason and recorded outcome. Normal users and connected agents cannot access admin functions.

The admin client is a separate application, not an extra tab in the user library. Keep Stash's fonts and logo. Use compact tables, plain labels and restrained colour. No promotional copy, animated backgrounds, oversized statistic cards or decorative charts.

## Proposed first-version scope

| Section | What it contains | Actions |
| --- | --- | --- |
| Overview | Total users, new users in the selected period, recently active users, saved-resource count, connected accounts and API/database readiness. A short list of issues that need attention. | Open the affected account or connection. Choose 7/30-day period. Refresh status. |
| Users | Searchable, paginated accounts with name, email, verification, active/suspended state, joined date, last activity and resource/connection counts. | Open an account. Filter by state and verification. |
| User details | Account identity and dates, verification, usage totals, recent administrative actions and a paginated list of its connections. | Suspend/restore access, resend verification, send password-recovery email, revoke a connection, sign out all sessions, disconnect all agents, delete the account. |
| Connections | Paginated key/OAuth connections across accounts, with owner, client name, permission, creation and last-use dates. OAuth access-token expiry is distinguished from connection expiry. | Filter by account/authentication method. Revoke a connection. |
| Activity | Append-only administrative audit records with actor, target, action, time, reason and outcome. | Search/filter and inspect a record. |
| Admin access | Administrator identities, roles, MFA state and latest admin sign-in. Owner-only management. | Invite an administrator, change their role, disable access, revoke admin sessions. |

Account detail is reached from Users, not a sixth navigation item. Admin access is hidden from operators/viewers, and also enforced server-side.

### Privacy boundary

The admin client shows account identity, operational state and usage counts. It does not expose saved titles, links, private notes, resource bodies, exports, password hashes, reset/verification tokens, session cookies, API keys or OAuth tokens. Counts are sufficient for ordinary support.

Viewing private library content or impersonating a user is outside this version. If that is needed later, agree on the exact support policy and access controls first. A user's profile bio and avatar are not needed in the initial admin table.

### Explicit exclusions

No billing, subscriptions, user impersonation, private-library browser, automatic moderation, bulk destructive actions, marketing email, SQL console, editable hosting secrets or a custom replacement for Railway/Vercel/Resend dashboards. Hosting-plan upgrades, backup provisioning and external alert subscriptions require their own scope. Showing that backups/alerts remain unconfigured does not count as enabling them.

## Clean interface specification

- Five small navigation links: Overview, Users, Connections, Activity and Admin access. Show only permitted sections.
- A narrow header contains Stash Admin, Alpha, the signed-in administrator and sign out.
- Overview uses a compact summary row, a health row and actionable issues. Start without charts. A zero count is not treated as an error; unavailable metrics say Unavailable.
- Users is the main working screen. Search and filters sit above one table. Use a full detail page for account actions, with Back to users retaining search/page state.
- User details has three sections: Account, Connections and Activity. Place destructive actions in an understated actions menu with an explicit confirmation dialog.
- Use one primary action at a time. Reserve red for failed states and destructive confirmation. Success messages are brief and disappear; failures stay visible with a retry.
- Loading, empty, permission-denied, session-expired and unavailable-server states need designed layouts, not placeholder dashboard widgets.
- Desktop tables remain readable at 1280/1440px. At 375/768px, prioritise name/status and show additional details after opening the account. No page-level horizontal overflow.
- Keyboard focus, table headers, meaningful button labels and screen-reader status updates are required. Status must never depend on colour alone.

## Architecture and ownership

| Area | Proposed implementation |
| --- | --- |
| Separate client | apps/admin, Next.js/TypeScript, its own package, build, environment and Vercel project. Local port 3001. Reuse brand assets and font files; no consumer routing changes. |
| Admin API | Dedicated /admin-api routes/modules in the existing Fastify service. No separate database or second copy of library business rules. |
| Services | Dedicated administration service for cross-account queries and actions. Reuse extracted account lifecycle/revocation/email services where appropriate. Normal library services retain their ownership checks. |
| Data | PostgreSQL locally and in production. Additive, versioned Drizzle migrations and indexes. |
| Authentication | Separate admin identities, sessions, MFA and invitations. Customer sessions and MCP credentials never grant admin access. |
| Browser boundary | Admin client proxies its admin API requests. Configure ADMIN_WEB_ORIGIN separately from consumer WEB_ORIGIN. Explicit origin checks for administrative mutations, plus independent authentication/authorisation. |
| Deployment | A separate Vercel admin project. Proposed hostname admin.stash.kasitek.co.za, subject to acceptance of this plan. Railway keeps the existing API/PostgreSQL resources. |

The consumer client must not import admin pages or obtain administrative credentials. Shared packages expose safe types, validation and brand assets, not server-side secret configuration. No admin operations are exposed as MCP tools.

## Access and safety rules

| Capability | Viewer | Operator | Owner |
| --- | --- | --- | --- |
| Overview/account metadata/connections/audit | Yes | Yes | Yes |
| Suspend/restore a customer, send support emails, revoke customer sessions/connections | No | Yes | Yes |
| Delete a customer account | No | No | Yes |
| Invite/disable admins, assign roles, revoke admin sessions | No | No | Yes |
| View private library content or secret credentials | No | No | No |

- Admin sign-in requires password plus TOTP MFA before issuing a privileged session. Store MFA secrets encrypted with a host-managed encryption key; store recovery-code digests only. Apply rate limits and reject reused TOTP/recovery codes.
- Bootstrap the first owner with an operator-run CLI and verification/enrolment flow. No public admin signup, default password, shared key or automatic promotion of the first customer.
- Invitations are owner-issued, expiring, single-use and tied to the invited email/role. Require verification and MFA enrolment before activating access. Do not allow an invite to create another owner accidentally.
- Proposed privileged session policy: 30-minute inactivity timeout and 8-hour absolute lifetime. Sensitive actions require a fresh password/MFA check within five minutes. Failed authorisation never extends a session.
- Use a dedicated host-only HttpOnly/Secure cookie in production. Different cookie names in local development are required because cookies are not isolated by port. Consumer and admin sign-out/session revocation remain independent.
- Read the current admin role/state when authorising requests. Removing access takes effect on the next request; a stale client screen is never authoritative.
- Prevent removing/disabling/demoting the final active owner, including concurrent requests. Audit changes to admin access. Customer-account deletion does not silently modify separate admin identities.
- Suspension revokes customer browser sessions, verification/reset tokens and all agent credentials. Check suspension in password sign-in, session lookup, token issuance/refresh and every MCP authentication path. Restoration does not resurrect revoked credentials.
- Destructive actions require a reason, target confirmation and recent authentication. Show the account being affected and the consequence before execution. Retries must not duplicate side effects.
- Do not mark a customer's email verified manually or choose their password. Support actions send the standard verification/recovery flow to their stored address, subject to cooldowns and the configured provider.
- Reuse the durable deletion journal and existing account deletion rules. Revocation/deletion must cascade correctly and remain effective after restore. Do not implement a second ad hoc SQL deletion path.
- Record mutations and their audit entry in the same transaction where possible. If the audit store is unavailable, do not perform an unaudited privileged mutation. Durable deletion-journal ordering must still follow the existing recovery contract.
- Audit records are immutable through the application, not claimed to be cryptographically tamper-proof. Record IDs, action, reason, outcome and a small allowlist of state changes; omit credentials, private content and unnecessary personal data. After deletion, retained records use non-identifying target references. Never copy email into permanent audit snapshots.

## Data and operational definitions

- New tables: admin identities, admin sessions, invitation-token digests, recovery-code digests, MFA replay state and admin audit records. Model owner/operator/viewer and active/disabled state explicitly.
- Add customer suspension state/time and its administrative reason. Add lastActiveAt if needed for the overview. Keep these fields outside customer-editable schemas.
- Last active means a successful authenticated customer API or MCP request. Update it at most once per five minutes per account; anonymous requests and background jobs do not count. It is approximate activity, not presence.
- Recently active means lastActiveAt within the selected period. Connected accounts have at least one usable manual key or an OAuth connection with a live refresh grant. An expired one-hour access token alone does not mean disconnected.
- Existing data has unknown historical activity. Do not fabricate past sign-ins or usage from signup dates. Label unavailable history honestly.
- Initial health checks show process/database readiness and whether sender/configuration prerequisites exist. Provider delivery, backup schedules and external alerts are shown as separately verified facts or Unknown, never inferred from HTTP 200.
- Admin audit retention is a release decision. Proposed initial policy: 90 days with no private content; confirm before enabling cleanup. Administrator disabling revokes access immediately. Define recovery for lost MFA before launch.
- All list endpoints use bounded pagination and indexed filters. Counts do not load private resource bodies. Avoid a query per user row. Sort by stable fields and include tie-breakers.

## Implementation checklist

### A1 Scope and interface review

- [x] A1.1 Confirm first-version actions, the privacy boundary, roles and proposed admin hostname.
- [x] A1.2 Confirm admin identity/bootstrap, MFA recovery and audit-retention policy.
- [x] A1.3 Create local designs for Overview, Users and User details, plus dialogs and empty/error states.
- [x] A1.4 Review desktop/mobile layouts before building every remaining page. Resolve the design direction without changing the consumer landing page.

Acceptance: the scope is agreed, screenshots are reviewable and no administrator can mistake a destructive action for a harmless edit.

### A2 Foundations, identity and permissions

- [x] A2.1 Add apps/admin, local environment example and isolated build output.
- [x] A2.2 Add migrations, indexed admin models and safe shared request/response types.
- [x] A2.3 Implement bootstrap, invitations, password/MFA sign-in, enrolment, recovery and session expiry/revocation.
- [x] A2.4 Implement a single admin authorisation boundary with role checks and origin protection.
- [x] A2.5 Implement audit writes and permission-aware error responses.
- [x] A2.6 Prove consumer sessions, API keys and OAuth tokens cannot enter admin routes.

Acceptance: a verified/MFA-enabled invited admin can sign in; a normal customer cannot. Disabling an admin removes access immediately. The last owner cannot be removed.

### A3 Account lifecycle and support

- [x] A3.1 Extract/reuse account deletion, session revocation and email issuance services without weakening customer ownership.
- [x] A3.2 Implement searchable/paginated user list and operational account detail.
- [x] A3.3 Implement suspension/restoration and enforce it in every customer/API/MCP authentication path.
- [x] A3.4 Implement sign-out-all, revoke-one/disconnect-all agents and standard support emails with cooldowns.
- [x] A3.5 Implement owner-only deletion with recent authentication, confirmation, reason, audit and durable deletion-journal replay.
- [x] A3.6 Test races between suspension/deletion and sign-in, OAuth exchange/refresh, key creation and admin role changes.

Acceptance: actions target only the selected account. Suspension denies access through both browser and agents; restoration requires new sign-in/connections. Account deletion remains durable after the existing restore drill.

### A4 Overview, connections and admin access

- [x] A4.1 Implement defined aggregate metrics and approximate activity collection.
- [x] A4.2 Implement bounded health/configuration status with timestamps and unavailable states.
- [x] A4.3 Implement global connection metadata and filters without exposing credentials.
- [x] A4.4 Implement searchable/paginated administrative activity.
- [x] A4.5 Implement owner-only admin invitation, role changes, disabling and session revocation.
- [x] A4.6 Check list performance with realistic disposable fixtures and inspect query counts/index usage.

Acceptance: metrics match the fixture data, filters paginate reliably, actions have audit records and operational status does not claim unconfigured backups or alerts are active.

### A5 Interface finish and regression

- [x] A5.1 Apply final compact layouts, typography and action hierarchy across all pages.
- [x] A5.2 Verify loading, empty, denied, failed-request and expired-session states.
- [x] A5.3 Verify keyboard use, dialog focus/return, screen-reader labels and contrast.
- [x] A5.4 Verify desktop, tablet and mobile without overflow or inaccessible actions.
- [x] A5.5 Run affected customer/OAuth/MCP regression tests, pnpm typecheck and production builds.
- [x] A5.6 Update docs/features, the canonical verification skill, docs/verification.md and docs/decisions.tsv with actual results.

Acceptance: admin journeys and existing customer journeys pass against the same backend revision. Screenshot proof matches the implemented design.

### A6 Deployment and hosted acceptance

- [x] A6.1 Configure admin domain/project, admin origin, encryption key and session settings without logging secrets or upgrading plans.
- [x] A6.2 Apply additive migrations and verify old customer data still works.
- [x] A6.3 Provision the initial owner securely; complete verification/MFA on the real admin client.
- [x] A6.4 Deploy locally verified API and admin artifacts. Check HTTPS, security headers, origin rules and cookie isolation.
- [ ] A6.5 Run hosted acceptance on disposable customer accounts: inspect, suspend, deny API/MCP, restore, reconnect, revoke and delete.
- [x] A6.6 Verify customer dashboard/MCP still work and admin functions are absent from their UI/tools.
- [x] A6.7 Record deployed revisions, domain details, recovery procedures and remaining infrastructure limitations.

Acceptance: an owner can complete the operational journey on the hosted admin client, all audit events exist and disposable test data is cleaned up. No private customer data appears in screenshots or logs.

## Verification matrix

| ID | Required proof |
| --- | --- |
| AT01 Admin boundary | Anonymous/customer/session/key/OAuth credentials fail admin access. Server enforces each role for every endpoint, regardless of client UI. |
| AT02 MFA and sessions | Correct enrolment/sign-in, rejected bad/reused codes, recovery-code single use, password verification, rate limits, idle/absolute expiry, recent-auth expiry and immediate role/disable/session revocation. |
| AT03 Admin ownership | Single-use invitations; no privilege escalation; simultaneous final-owner removals leave an active owner. Customer deletion does not remove independent admin identities. |
| AT04 Account isolation | Ordinary accounts retain private libraries and ownership checks. Admin metadata responses/exports/logs never contain private resources, hashes or tokens. Use deliberately sensitive fixture values to test redaction. |
| AT05 Suspension | Browser sign-in/existing sessions, manual MCP keys, OAuth codes/access/refresh and key creation all deny suspended accounts. Requests racing suspension cannot create surviving usable credentials. Restoration does not resurrect them. |
| AT06 Support actions | Correct recipient, email-provider failure, disabled email, cooldowns, verification/recovery single use, independent session and agent revocation, wrong-target IDs and no manual verification/password override. |
| AT07 Deletion/recovery | Owner-only fresh-auth confirmation; durable deletion journal; cascade and replay; repeated requests; database/email/journal failures and concurrent actions. |
| AT08 Audit | Successful mutations have actor/target/reason/outcome; failures do not create false success; audit failure blocks privileged changes; no application edit/delete path; retention and redaction follow policy. |
| AT09 Metrics/performance | Counts/activity definitions match fixtures, unknown history stays unknown, expired OAuth access differs from refresh availability, stable filtering/pagination and no N+1 private-content queries. |
| AT10 Browser journeys | Owner/operator/viewer journeys, account actions, denied controls, search-state restoration, error/retry, keyboard/dialog focus, mobile overflow and axe checks. Real API/PostgreSQL, not mocked user data. |
| AT11 Regression | Customer signup/verification/recovery/library/import/export/deletion, cross-account isolation, manual MCP, two OAuth clients, refresh/revocation and domain discovery remain passing. |
| AT12 Hosted release | Admin/consumer cookie isolation, HTTPS/headers/origin policy, secure owner bootstrap, disposable account lifecycle, recorded deployment revisions and cleaned test data. |

Integration tests must use disposable PostgreSQL schemas. Never point fixtures at production accounts. Browser verification must exercise real endpoints, persist results, and capture sanitised screenshots. Hosted checks use explicitly created disposable accounts only. No test passes until it has run; record failed/pending checks as such.

## Delivery order and completion rules

Deliver the admin sign-in and user-list design first, then identity/permission foundations, account actions, operational views and deployment. This order makes the most sensitive boundary testable before exposing cross-account management.

A checklist item is complete only when its acceptance criteria and affected verification IDs pass, evidence is saved and limitations are recorded. No unchecked security or deletion-recovery requirement can be labelled complete based on a working screen. The user accepted the plan and authorised implementation on 14 October 2026, including its separate admin deployment. Account operations are verified using disposable data; provisioning the permanent owner uses the invitation email supplied privately in the conversation.


## Evidence and work remaining

14 October: 46 PostgreSQL integration tests passed, including admin permissions, MFA replay/session expiry, final-owner races, OAuth/key suspension races, deletion journalling/replay, audit outages, encrypted email retries and mail/suspension lock ordering. Production builds and typechecking passed for both clients and the server. The disposable capacity check used 10,000 customers and 50,000 resources, with 13–47 ms API timings and indexed plans. The owned-PostgreSQL restart/restore drill passed. Final browser verification and hosted acceptance are recorded below as they finish. Screenshots, reports and capacity proof are in docs/evidence/admin. The owner invitation destination was supplied privately; the human sets their own password and authenticator.

Final combined browser run passed 13 tests, including both admin journeys and all consumer/OAuth journeys. Desktop/tablet/mobile screenshots were inspected, admin users axe had zero violations, and dialog focus/Escape, expired sessions, API unavailability/retry, pagination and period switching were exercised. Deployed acceptance remains pending.

Deployment 88be701: Railway fd1eeace-0c52-40bb-9ae1-85aea9b2fd70 SUCCESS, admin Vercel dpl_7XBgjaahyTF8hwNvNuiD5WbMmNMZ READY and consumer Vercel dpl_4cyivxaKg1MUXZUQuqRsr7nADQZ4 READY. Migration 0005 preserved the one existing customer and 13 resources. The initial owner invitation was sent; human enrolment and hosted privileged acceptance remain pending. Anonymous HTTPS/origin/discovery checks passed.

Hosted consumer regression passed against the new API: production verification email, OAuth discovery/DCR/PKCE/consent, MCP save/retrieve, read-only manual key retrieval, refresh rotation and revocation. Its disposable account/resources were deleted. Remaining A6.3/A6.5 require the permanent owner to complete their personal enrolment; no production admin credentials were set on their behalf.

Completion audit strengthened the operator browser journey, admin login rate limiting, independent session/agent revocation, concurrent suspension/deletion credential issuance and journal/SQL failure recovery. The 19 focused admin integration tests and two focused browser cases passed, with fresh typechecking and production builds. See docs/evidence/admin/completion-audit.md. GitHub CI could not start because of an account billing/spending-limit restriction; no remote CI success or paid configuration change is claimed. Owner enrolment and the hosted privileged lifecycle are still the two unchecked release gates.

Production owner enrolment is now complete: the activation query returned one active owner and zero pending owner invitations. The accessible Codex browser tab is still signed out, so A6.5 awaits a usable owner browser session. A verified disposable customer and MCP key are prepared for that journey; its credentials stay only in ignored private state.
