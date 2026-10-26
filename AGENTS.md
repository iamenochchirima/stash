# Working on Stash

Use `IMPLEMENTATION.md` as the historical first-release checklist. New implementation specifications, tasks, dependencies, and progress belong in the Linear project below. Keep `FEATURE_BACKLOG.md` out of the current release unless the user changes scope. Do not create new repository implementation plans.

## Project notes and work tracking

- Repository: https://github.com/iamenochchirima/stash
- Stash research workspace: https://stash.kasitek.co.za/projects/4ee87de0-6b69-4e8c-82ed-c2dc73a78150, project ID `4ee87de0-6b69-4e8c-82ed-c2dc73a78150`.
- Linear team: KasiTek, key `KAS`, ID `e78157db-f78a-498e-8f1f-1604b20914a1`. Verified team and project access through the connected Linear integration.
- Linear project: https://linear.app/kasitek/project/stash-ce32ed3f1713, project ID `9663caed-5c58-4c40-95ba-e6d9fa4ea00b`.

Use `project-notes` during research and design. Save ideas, research, and working drafts in this project's Stash workspace. Use `to-spec` for substantial work needing a shared specification, and `to-tickets` for its implementation breakdown in Linear. Keep only settled, maintained documentation in the repository. Small changes can go directly to `to-tickets`. Saved research is reference material, not implementation approval. Update affected project documentation alongside code.

Use `prepare-project` for setup changes. `e-mode` routes work and `long-running-work` owns substantial implementation, Linear progress, and checkpoints. Use `clean-interface` for interface changes and the canonical `verify-stash` skill for real user paths. Use `maintain-verification-skill` when those recipes change. The remaining Estack skills are installed globally for Codex and should be used when applicable, rather than invoked for every task.

Create new agreed tickets in Backlog. Obtain breakdown approval before ticket publication through `to-tickets`. Publication and resolved dependencies do not approve implementation. Agent-picked work requires explicit scope approval and the configured `ready-for-agent` label. If that label is absent, report it rather than creating labels or changing workflow settings. A direct user implementation request authorizes its stated scope. Do not treat this setup or the Topics planning request as implementation authorization.

## Commit completed work

After each completed, coherent fix or update in a Git repository, create a local commit without waiting for a reminder or additional confirmation. Use focused checks appropriate to the change and the user's verification preferences.

Include only files or hunks that belong to that work. Preserve unrelated edits, and never commit secrets or generated runtime state. Do not present incomplete work as a completed fix. Report the commit hash, a short summary, and relevant work left uncommitted. If a commit cannot be made, explain the blocker. Pushing, opening a pull request, merging, and releasing require their own authorization.

## Product and verification rules

Use PostgreSQL for development and production. Preserve multiple collections per resource and ownership checks in shared services. API and MCP must use the same rules. Do not log credentials, session cookies, password/reset data, or private notes.

The canonical verification skill is `.agents/skills/verify-stash/SKILL.md`. Read it before verifying a user-facing change. Current features and evidence recipes are in `docs/features/README.md`; update the affected feature entry when behavior changes. Commands, environments, results, and remaining limitations belong in `docs/verification.md`. Append meaningful decisions to `docs/decisions.tsv`.

Run the focused tests for the changed behavior, `pnpm typecheck`, and the production build. Run browser checks for UI/authentication flow changes. The tests use disposable PostgreSQL schemas. Never point tests at live user data or stop a PostgreSQL cluster owned by another project.

The user authorized deployment to Railway and Vercel on 12 October 2026, and subsequently authorized using the KasiTek Growth Resend credentials to enable verification and recovery. Do not upgrade hosting plans without further direction. See docs/operations.md for deployed resources and remaining backup/alert limitations.
