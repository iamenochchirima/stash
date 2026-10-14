# Stash operation and recovery

The user authorized public deployment on 12 October 2026: Railway for PostgreSQL and the API/MCP service, Vercel for the dashboard. The initial deployment disabled email. The user subsequently authorized reusing KasiTek Growth’s Resend credentials to enable verification and recovery. See [deployment evidence](evidence/hosted-deployment.json).

Dashboard: https://stash.kasitek.co.za. API: https://api.stash.kasitek.co.za. MCP uses the same backend at `/mcp`. Railway project Stash: `4d983b61-c991-4730-9e3f-6ed0187d4683`. Vercel project: `stash`, scope `iamenochchirimas-projects`.

Cloudflare DNS has a DNS-only CNAME for `stash` pointing to `c27f10fdbbc3ce01.vercel-dns-017.com`. Vercel verified the domain and serves HTTPS. The previous `stash-tau-seven.vercel.app` hostname redirects to the custom domain with status 308, preserving paths and query strings. WEB_ORIGIN is `https://stash.kasitek.co.za`, so newly generated verification/recovery links use that address. Existing host-only browser cookies are not transferred; users may need to sign in again on the custom domain. The API now uses api.stash.kasitek.co.za; see the API custom domain entry below.

## Runtime configuration

Use PostgreSQL 18 and Node.js 24 LTS. The dashboard is a Vercel project rooted at `apps/web`; the backend is built by the root Dockerfile on Railway. Build from the workspace root with `pnpm install --frozen-lockfile` and `pnpm build`. Start the backend with `pnpm --filter @stash/server start` and the dashboard with `pnpm --filter @stash/web start`.

Set `DATABASE_URL`, HTTPS `WEB_ORIGIN`, HTTPS `PUBLIC_API_URL`, `RESEND_API_KEY` or `SMTP_URL`, `MAIL_FROM`, and `DELETION_JOURNAL_DIR` for the backend. `WEB_ORIGIN` is the precise browser origin, and `PUBLIC_API_URL` is the externally visible backend origin. Set the dashboard's `API_URL` before building so its API proxy reaches the backend. Use the platform's `PORT` for each service. Production refuses incomplete configuration. `EMAIL_DISABLED=true` explicitly permits operation without SMTP and disables verification/recovery email issuance. The UI hides recovery and verification prompts; agent keys are permitted without verified email in this temporary mode. `emailVerified` remains false. When adding RESEND_API_KEY or SMTP_URL plus MAIL_FROM, remove EMAIL_DISABLED or set it to false. Existing users must then verify their email before agent key creation or MCP access.

The hosted sender is `Stash <noreply@kasitek.co.za>` through Resend’s HTTPS API. RESEND_API_KEY is stored only in Railway service variables, copied privately from the user-authorized KasiTek Growth credential. The source project was not changed. Resend takes precedence over SMTP when both are configured. Provider requests time out after 10 seconds and failures expose only a generic error. Never put this key in Vercel, browser configuration, or committed files. Secrets belong in host-managed variables, with database and SMTP access limited to the operator and application services.

## Migrations and rollback

For local releases, run `pnpm db:migrate` before starting the new build. The Railway Dockerfile runs the bundled migration entry point before starting its single backend instance. SQL migrations are versioned, checksummed, transactional, and serialized with a PostgreSQL advisory lock. Changed applied migrations are rejected. Ordinary server startup never modifies the schema.

Migration 0002 preserves legacy collection membership while adding accounts and multiple collections. Migration 0003 adds a stored search document and indexes. The pre-release one-collection scaffold cannot run after migration 0002; do not roll back to that scaffold against the upgraded schema.

For an application-only rollback, use the previous compatible artifact. For an incompatible schema rollback, restore the pre-upgrade database into an isolated database, verify it with that artifact, reapply later account deletions, and switch traffic only after validation. Treat data written after the snapshot explicitly; do not overwrite a live database blindly. The local recovery drill validates restore and deletion replay, not a live Railway rollback.

## Health and monitoring

`GET /health` reports process liveness and version. `GET /ready` checks database availability and returns 503 during outages. The connection pool replaces failed idle connections. SIGTERM/SIGINT stop the server and close database connections.

Configure readiness-based deployment checks and alerts for repeated readiness failures, HTTP 5xx increases, and email delivery failures. Resend delivery events are visible in the provider dashboard; application acceptance does not guarantee a message reaches a user’s inbox. Logs include request IDs and event names, and omit cookies, authorization, query credentials, passwords, notes, and internal error details. Railway uses `/ready` with a 300-second deployment timeout, one replica, and an ON_FAILURE restart policy with 10 retries. External uptime/error notifications have not been activated.

## Backups and account deletion

The proposed production policy is daily encrypted database backups retained for 7 days. The deployed Railway workspace rejected automatic volume backups because they require a Pro workspace. No schedule or manual snapshot was created, and PITR is disabled. Confirm a plan upgrade or another secure backup destination before relying on this deployment for retained data. The application does not assume the host has configured backups automatically.

`pg_dump --format=custom` and `pg_restore` provide a local recovery path. Store production snapshots securely outside the live database. Restrict access and test restoration in an isolated database before routing traffic.

Account deletion writes a durable intent containing only the user UUID and request time before removing the live account and all dependent records. The journal is outside the database dump. Keep `DELETION_JOURNAL_DIR` on persistent storage, separately from the database recovery snapshot. Back it up independently and retain it longer than the oldest database backup. Preserve the journal during rollback and deploys; a new empty directory is not a valid replacement.

Before accepting traffic after a restore, startup replays the deletion journal. This removes restored profiles, resources, collections, tokens, credentials, and sessions for deleted users. If a crash occurs between journaling and database commit, replay conservatively completes the user's requested deletion. A malformed journal blocks startup so the operator can investigate, rather than silently restoring deleted users.

The backend journal is on a separate persistent Railway volume mounted at `/data`, with DELETION_JOURNAL_DIR=/data/deletions. PostgreSQL has its own persistent volume. One backend replica is configured. Multiple independent backend instances require a shared durable journal service or shared filesystem; do not scale replicas onto separate journals. Confirm this storage contract before launch.

The local recovery script restores a disposable schema, proves the deleted account reappears in the raw snapshot, and then proves journal replay removes it. It also restarts the project-owned PostgreSQL cluster and checks resource, collection, credential, session, and onboarding persistence with the built production server.

```sh
pnpm build
pnpm exec tsx scripts/recovery-check.ts
```

This drill uses the native project-owned PostgreSQL cluster and temporarily restarts it. Run it only when no other Stash verification process is using that cluster. It leaves evidence in `docs/evidence/recovery.json`, removes the disposable schema, and deletes the private backup file.

## Launch checklist still outside the build scope

Platform domains and HTTPS are active; the hosted signup, sign-in, library persistence, MCP SDK save/retrieve, scope/revocation, origin rejection, and account deletion checks passed. The disposable account was deleted. Automatic backups, external alerts, a hosted restore drill, and a hosted real Codex/OpenCode acceptance rerun remain pending. Email uses Resend rather than SMTP. The earlier real client acceptance and restore drill cover local behavior. No workspace upgrade was performed.


## Client deployment and Git connection, 12 October 2026

Published client commit 7727814 to https://stash.kasitek.co.za. Vercel deployment dpl_6R2LLRc2DvhYg98NtLybUgUYuHif is READY. Live checks passed for the new landing hero/Lina icon, the connection CTA opening sign-in, and signup. Railway readiness returned 200.

The initial Vercel project had no Git repository link, so GitHub pushes did not trigger deployment. Connected iamenochchirima/stash through Vercel's Git integration and verified productionBranch is main. Future main pushes are configured for production builds; the next push event has not yet been exercised. See docs/evidence/latest-client-deployment.json.


## OAuth deployed alongside agent keys

Implementation commit 057aa8a is deployed. Railway backend deployment 07835852-8401-486f-bff0-1dc9b87897ac is SUCCESS with the additive 0004_oauth migration. Vercel Git-triggered production deployment dpl_KJxneHMZ8XbUWxoMFdpv7dvjFQYf is READY on stash.kasitek.co.za. This push demonstrates that the Git connection now triggers builds automatically. Railway backend deployments remain CLI-managed.

Hosted verification passed after the final concurrency refinement: issuer/resource discovery, DCR, PKCE, signup intent preservation, verification/consent, OAuth saving/retrieval, manual-key retrieval and read-only scope, token refresh, and revocation. The disposable account and its resources were deleted. See docs/evidence/oauth-hosted.json.

Use the existing HTTPS /mcp URL with OAuth or a bearer key. In an OAuth client choose dynamic client registration and public-client authentication when a registration mode is requested. Client ID Metadata Documents and confidential-client secrets are not advertised. The current consent scopes are stash:read and stash:write; write includes saving and deleting. Tokens expire after one hour, refresh tokens rotate with a 30-day absolute lifetime, and revocation/reset/deletion invalidates the connection.

Public DCR is rate-limited to 20 registrations per minute per source and capped at 10,000 stored clients. Pending authorization requests/codes expire and are cleaned during new authorizations. Retention/cleanup of unused public client registrations is an operational follow-up before approaching that cap. The service does not fetch client-provided URLs. Native ChatGPT UI acceptance remains a separate user/client check; the hosted SDK flow has been exercised.

## API custom domain — 13 October 2026

The canonical API origin is https://api.stash.kasitek.co.za and MCP endpoint is https://api.stash.kasitek.co.za/mcp. Railway custom domain `32cc7f99-99b5-4df4-97a5-8f6e27ac339d` routes to the existing stash-api service. Cloudflare has a DNS-only CNAME `api.stash` to `z10lc19h.up.railway.app` and Railway's ownership-verification TXT record at `_railway-verify.api.stash`. Railway reports the domain active, ownership verified and its HTTPS certificate valid.

Updated Railway PUBLIC_API_URL to the new origin. Configuration redeployment `1a539add-555f-431b-a59b-8ac1dfeeafac` succeeded using the existing application image. The dashboard API proxy retains its existing Railway hostname and works against the same backend; its returned MCP setup address now uses the custom domain. No hosting plan changes were made.

Agent-key clients using the previous Railway MCP URL must update their server URL; their keys remain valid. OAuth clients must reconnect because issuer and resource URLs changed. The old Railway hostname remains available for the dashboard proxy and health checks, but the MCP host guard accepts the canonical custom hostname. Health/readiness, OAuth issuer/resource endpoints, unauthenticated MCP challenge, and public dashboard/proxy checks passed. See docs/evidence/api-custom-domain.json. No new account or live-user data was changed during these checks.

## Admin access

The separate Next client is apps/admin, local port 3001, Vercel project stash-admin. Production origin is https://admin.stash.kasitek.co.za. Its API_URL targets https://api.stash.kasitek.co.za. The existing Railway backend hosts dedicated /admin-api routes. Admin routes are enabled only with ADMIN_ENCRYPTION_KEY and production additionally requires HTTPS ADMIN_WEB_ORIGIN. The consumer WEB_ORIGIN remains independent.

ADMIN_ENCRYPTION_KEY must decode to exactly 32 bytes of canonical base64. Generate it privately, store it in Railway, and preserve it securely across restarts, redeploys and restores. It encrypts TOTP secrets and queued support email payloads. Loss of the key makes old MFA factors unreadable; do not overwrite it during ordinary deployment. Never put it in Vercel or a NEXT_PUBLIC variable. Migration 0005 is additive and retains existing customer data.

Initial owner provisioning on the deployed backend uses node /app/apps/server/dist/bootstrap-admin.js <email> <name> through railway ssh --service stash-api. It refuses if any administrator already exists. The destination receives a 24-hour single-use fragment invitation, chooses a password, scans their own authenticator QR and saves eight single-use recovery codes. No default password or public admin signup exists. Invitation fragments are removed from browser history; logs never record their values.

Owners invite viewers/operators through Admin access, then explicitly assign ownership if needed. Keep another owner and recovery codes available. The final usable owner cannot be disabled or demoted. Sessions expire after 30 minutes idle or eight hours absolute. Sensitive actions require password plus a new authenticator/recovery code within five minutes. Production __Host-stash_admin is Secure, HttpOnly, SameSite=Strict, host-only and independent of consumer cookies.

For lost MFA, first use a saved recovery code and replace the authenticator under Your security. If all factors are lost, an authorised infrastructure operator must verify the person's identity out of band before running node /app/apps/server/dist/recover-admin.js <email>. This preserves their existing role, immediately revokes admin sessions/recovery codes, marks recovery pending, and emails a new enrolment link. A delivery failure leaves access blocked until the operator retries; it does not reactivate the old factors. Do not use this to grant new ownership.

Admin mutations require a reason and confirmation and fail if audit storage is unavailable. Customer deletion records an authorised audit intent before appending the durable deletion journal, then deletes in the shared lifecycle service. If a later SQL commit fails after journaling, startup conservatively completes the authorised deletion. Recovery snapshots must include both database and the separately persistent deletion journal.

Support emails use standard customer verification/reset tokens, a five-minute per-purpose cooldown, encrypted retry jobs and provider idempotency. Resend acceptance is not inbox delivery. Retries stop after three attempts or cancellation; suspended/deleted customers and disabled/demoted senders cancel queued jobs. The worker follows actor, customer, job lock order. Audit cleanup retains 90 days, runs at startup and daily. Expired admin sessions/invitations and terminal email jobs older than seven days are cleaned too. The operator can run node /app/apps/server/dist/maintain-admin.js.

Admin Overview reports configured email, live database readiness and known backup/alert gaps. Automatic production backups and external alerts remain unconfigured. This admin release does not change hosting plans or enable those services.

Admin production revision 88be701 is live. Railway deployment fd1eeace-0c52-40bb-9ae1-85aea9b2fd70 is SUCCESS with migration 0005. Admin Vercel deployment dpl_7XBgjaahyTF8hwNvNuiD5WbMmNMZ and consumer dpl_4cyivxaKg1MUXZUQuqRsr7nADQZ4 are READY. Cloudflare has a DNS-only admin.stash CNAME to b22234dd4b5fdb11.vercel-dns-017.com; Vercel verified it and serves HTTPS. Main pushes trigger both client projects; Railway remains CLI-managed. Existing customer/resource counts were unchanged across the migration. The permanent owner invitation was sent through the deployed bootstrap CLI; owner enrolment and hosted privileged acceptance are still pending. See docs/evidence/admin/deployment.json and hosted-boundaries.json.
