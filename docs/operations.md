# Stash operation and recovery

The user requested a completed project and local verification, with Railway hosting and business email configuration deferred. No domain, paid service, or public deployment has been provisioned. These instructions prepare that later step.

## Runtime configuration

Use PostgreSQL 18 and Node.js 24 LTS. The web and backend can be separate Railway services. Build from the workspace root with `pnpm install --frozen-lockfile` and `pnpm build`. Start the backend with `pnpm --filter @stash/server start` and the dashboard with `pnpm --filter @stash/web start`.

Set `DATABASE_URL`, HTTPS `WEB_ORIGIN`, HTTPS `PUBLIC_API_URL`, `SMTP_URL`, `MAIL_FROM`, and `DELETION_JOURNAL_DIR` for the backend. `WEB_ORIGIN` is the precise browser origin, and `PUBLIC_API_URL` is the externally visible backend origin. Set the dashboard's `API_URL` before building so its API proxy reaches the backend. Use the platform's `PORT` for each service. Production refuses incomplete configuration.

The sender will use the user's business email service when chosen. SMTP delivery was verified against a local capture server, not a real business sender. Secrets belong in host-managed variables, with database and SMTP access limited to the operator and application services.

## Migrations and rollback

Run `pnpm db:migrate` as a single release job before starting the new build. SQL migrations are versioned, checksummed, transactional, and serialized with a PostgreSQL advisory lock. Changed applied migrations are rejected. Ordinary server startup never modifies the schema.

Migration 0002 preserves legacy collection membership while adding accounts and multiple collections. Migration 0003 adds a stored search document and indexes. The pre-release one-collection scaffold cannot run after migration 0002; do not roll back to that scaffold against the upgraded schema.

For an application-only rollback, use the previous compatible artifact. For an incompatible schema rollback, restore the pre-upgrade database into an isolated database, verify it with that artifact, reapply later account deletions, and switch traffic only after validation. Treat data written after the snapshot explicitly; do not overwrite a live database blindly. The local recovery drill validates restore and deletion replay, not a live Railway rollback.

## Health and monitoring

`GET /health` reports process liveness and version. `GET /ready` checks database availability and returns 503 during outages. The connection pool replaces failed idle connections. SIGTERM/SIGINT stop the server and close database connections.

Configure readiness-based deployment checks and alerts for repeated readiness failures, HTTP 5xx increases, and email delivery failures. Logs include request IDs and event names, and omit cookies, authorization, query credentials, passwords, notes, and internal error details. Add host-specific alerts when deploying; none have been activated remotely.

## Backups and account deletion

The proposed production policy is daily encrypted database backups retained for 7 days. Confirm Railway's actual backup schedule, retention, restore access, and cost before launch. The application does not assume the host has configured backups automatically.

`pg_dump --format=custom` and `pg_restore` provide a local recovery path. Store production snapshots securely outside the live database. Restrict access and test restoration in an isolated database before routing traffic.

Account deletion writes a durable intent containing only the user UUID and request time before removing the live account and all dependent records. The journal is outside the database dump. Keep `DELETION_JOURNAL_DIR` on persistent storage, separately from the database recovery snapshot. Back it up independently and retain it longer than the oldest database backup. Preserve the journal during rollback and deploys; a new empty directory is not a valid replacement.

Before accepting traffic after a restore, startup replays the deletion journal. This removes restored profiles, resources, collections, tokens, credentials, and sessions for deleted users. If a crash occurs between journaling and database commit, replay conservatively completes the user's requested deletion. A malformed journal blocks startup so the operator can investigate, rather than silently restoring deleted users.

For the first deployment, a persistent volume can hold the journal if only one backend instance is running. Multiple independent backend instances require a shared durable journal service or shared filesystem; do not scale replicas onto separate journals. Confirm this storage contract before launch.

The local recovery script restores a disposable schema, proves the deleted account reappears in the raw snapshot, and then proves journal replay removes it. It also restarts the project-owned PostgreSQL cluster and checks resource, collection, credential, session, and onboarding persistence with the built production server.

```sh
pnpm build
pnpm exec tsx scripts/recovery-check.ts
```

This drill uses the native project-owned PostgreSQL cluster and temporarily restarts it. Run it only when no other Stash verification process is using that cluster. It leaves evidence in `docs/evidence/recovery.json`, removes the disposable schema, and deletes the private backup file.

## Launch checklist still outside the build scope

Choose domains and the business sender, set up HTTPS and SMTP, confirm hosting costs, configure the durable journal and backups, activate monitoring alerts, and obtain public deployment approval. After deployment, rerun the hosted signup/recovery, library, cross-agent, deletion, and restore checks. Local evidence does not prove hosted mail delivery, TLS, backups, or alerts.
