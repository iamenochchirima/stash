# Working on Stash

Use `IMPLEMENTATION.md` as the first-release checklist. Keep `FEATURE_BACKLOG.md` out of the current release unless the user changes scope.

Use PostgreSQL for development and production. Preserve multiple collections per resource and ownership checks in shared services. API and MCP must use the same rules. Do not log credentials, session cookies, password/reset data, or private notes.

The canonical verification skill is `.agents/skills/verify-stash/SKILL.md`. Read it before verifying a user-facing change. Current features and evidence recipes are in `docs/features/README.md`; update the affected feature entry when behavior changes. Commands, environments, results, and remaining limitations belong in `docs/verification.md`. Append meaningful decisions to `docs/decisions.tsv`.

Run the focused tests for the changed behavior, `pnpm typecheck`, and the production build. Run browser checks for UI/authentication flow changes. The tests use disposable PostgreSQL schemas. Never point tests at live user data or stop a PostgreSQL cluster owned by another project.

The user authorized deployment to Railway and Vercel on 12 October 2026, and subsequently authorized using the KasiTek Growth Resend credentials to enable verification and recovery. Do not upgrade hosting plans without further direction. See docs/operations.md for deployed resources and remaining backup/alert limitations.
