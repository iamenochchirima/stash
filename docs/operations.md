# Stash operation and recovery

The user authorized public deployment on 12 October 2026: Railway for PostgreSQL and the API/MCP service, Vercel for the dashboard. The initial deployment disabled email. The user subsequently authorized reusing KasiTek Growth’s Resend credentials to enable verification and recovery. See [deployment evidence](evidence/hosted-deployment.json).

Dashboard: https://stash-tau-seven.vercel.app. API: https://stash-api-production-6e87.up.railway.app. MCP uses the same backend at `/mcp`. Railway project Stash: `4d983b61-c991-4730-9e3f-6ed0187d4683`. Vercel project: `stash`, scope `iamenochchirimas-projects`.

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
