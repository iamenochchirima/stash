# Stash

A private research library with user profiles, collections, and remote MCP access. Save a resource through the dashboard or an agent, then find it from another connected agent.

The first-release checklist is in [IMPLEMENTATION.md](IMPLEMENTATION.md). Future features live separately in [FEATURE_BACKLOG.md](FEATURE_BACKLOG.md). Verification results and known limits are recorded in [docs/verification.md](docs/verification.md).

The hosted dashboard is [Stash](https://stash-tau-seven.vercel.app). The API and MCP run on Railway with PostgreSQL. Email verification and recovery use Resend with the verified KasiTek business sender. See [operating details](docs/operations.md) for endpoints and the pending backup/alert setup.

## Local setup

Use Node.js 24 LTS, pnpm 10.30.1, and PostgreSQL 18. Development and tests both use PostgreSQL.

```sh
pnpm install --frozen-lockfile
./scripts/postgres-local.sh start
pnpm db:migrate
pnpm dev
```

The native PostgreSQL helper requires `pg_config`, `initdb`, and `pg_ctl`. It creates a project-owned cluster in `.data/postgres`, binds only to `127.0.0.1:55432`, and uses local trust authentication for development. Never expose this cluster publicly. Set `STASH_PG_BIN` if the PostgreSQL binaries are in a different directory. Stop only this cluster with `./scripts/postgres-local.sh stop`.

Alternatively, run `docker compose up -d postgres`, set `DATABASE_URL` to the Docker connection string in `.env.example`, and create `stash_test` using that local database user before tests. Use one database setup at a time because both default to port 55432.

Open [Stash locally](http://127.0.0.1:3000). The backend runs on port 4000. Use the exact configured browser origin; `localhost` and `127.0.0.1` are different origins.

Environment variables are described in `.env.example`; export them in your shell or configure them in your host. Files named `.env` are not automatically loaded. An existing PostgreSQL server can be used by setting `DATABASE_URL`. Tests require `TEST_DATABASE_URL` pointing to a database whose name ends in `_test`, and create disposable schemas without touching other schemas.

## Development email

Without `SMTP_URL`, no email is sent. Verification and password recovery messages are captured as private JSON files in `.data/mail`. Open the newest file for your test email address and follow its link. For example, from the repository root:

```sh
ls -t .data/mail
```

Captured messages contain single-use credentials. They are ignored by Git and must never be published. Production requires `MAIL_FROM` and either `RESEND_API_KEY` or `SMTP_URL` when email is enabled. The hosted service uses Resend with `EMAIL_DISABLED=false`: verification and recovery emails are active, and agent keys require verified email. An explicit `EMAIL_DISABLED=true` can temporarily disable these features.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
pnpm exec tsx scripts/capacity-check.ts
```

Browser verification starts its own isolated API on 4100 and dashboard on 3100, then stops them and drops its test schema. It saves screenshots in `docs/evidence/browser/` and failure traces in `test-results/`. Keep these ports free. See [the verification skill](.agents/skills/verify-stash/SKILL.md) for the repeatable user path and cleanup rules.

`pnpm exec tsx scripts/clients-check.ts` runs a real Codex save and OpenCode retrieval using disposable credentials and an isolated library. It uses the clients' configured model/account access, so run it only where both are authenticated. It does not modify their persistent MCP configuration. Raw outputs are sanitized before saving; credentials are revoked and the temporary database schema is dropped.

## Build and run

```sh
pnpm build
pnpm --filter @stash/server start
pnpm --filter @stash/web start
```

The server build bundles shared workspace code and includes versioned SQL migrations. Migrations are explicit with `pnpm db:migrate`; ordinary server startup does not alter the schema. Run migrations before starting a new build. In production, set `NODE_ENV=production`, `DATABASE_URL`, HTTPS `WEB_ORIGIN` and `PUBLIC_API_URL`, `SMTP_URL`, and `MAIL_FROM`. Configure `API_URL` for the web server at build time so its `/api` proxy reaches the backend.

## Agent access

Verify your email, open Agent connections, and create a named read-only or read/write key. Copy it once. Every request uses `Authorization: Bearer <key>`. Read/write keys can also permanently delete resources. Revocation blocks new requests immediately.

The remote endpoint is `/mcp` using Streamable HTTP. It exposes resource save/search/list/get/delete and collection listing according to scope. Setup instructions for verified clients are in [docs/agents.md](docs/agents.md); user-facing privacy, recovery, import/export, and deletion help is available at `/help`.

## Project structure

- `apps/web`: Next.js dashboard, account flows, and help.
- `apps/server`: Fastify API, account/email/metadata services, and MCP transport.
- `packages/core`: Shared ownership-aware library services and portability.
- `packages/db`: Drizzle schema, PostgreSQL connections, and SQL migrations.
- `packages/shared`: Validated input schemas, types, and limits.
- `tests`: PostgreSQL integration, MCP, metadata, and browser checks.
- `docs`: Decisions, verification results, and operating instructions.

Hosting preparation is in [docs/operations.md](docs/operations.md). Public deployment is outside the current build request.
