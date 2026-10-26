# Stash project setup

Updated 26 October 2026 using `prepare-project`. This record describes the development workflow. Product scope and task progress belong in Linear.

## Canonical records

| Record | Location and responsibility |
| --- | --- |
| Product purpose and development commands | [README](../README.md), reused |
| Architecture and original design context | [arch.md](../arch.md), reused with current implemented behavior in the feature map |
| Agent instructions and associations | [AGENTS.md](../AGENTS.md), updated |
| Current product behavior | [Feature map](features/README.md), reused, with Topics excluded until implemented |
| Verification recipes | [verify-stash](../.agents/skills/verify-stash/SKILL.md), reused |
| Verification results and limits | [Verification log](verification.md), updated for this setup |
| Hosting, credentials configuration, and recovery limits | [Operations](operations.md), reused |
| Significant decisions | [Decision records](decisions.md) and [checkpoint history](decisions.tsv), reused |
| Research and drafts | [Stash workspace](https://stash.kasitek.co.za/projects/4ee87de0-6b69-4e8c-82ed-c2dc73a78150), created and read back |
| Specifications and implementation progress | [Linear project](https://linear.app/kasitek/project/stash-ce32ed3f1713), created under KasiTek and read back |
| Reproducible configuration | Existing `package.json`, `pnpm-lock.yaml`, `.env.example`, `.gitignore`, and `playwright.config.ts`, reused |

Historical root implementation checklists remain as release history. The former Topics draft now points to its Linear specification. Do not create parallel Markdown plans, research dumps, or ticket lists in the repository.

## Skills and instruction loading

Codex is the selected agent for this setup. It loads the root `AGENTS.md`, with the global commit rule also present in `/home/enock/.codex/AGENTS.md`. The project file contains one commit section that agrees with the global rule. Other agents are not claimed as configured.

The verified Estack source is `https://github.com/iamenochchirima/estack.git`, checked out at `/home/enock/Desktop/workspace/personal/estack`, revision `6f8cddc5e845fb1d0b3da6bfddcc427bf08ef12c`. The global skill lock identifies that source. All 11 source skills and their supporting file paths exist under both `/home/enock/.agents/skills` and `/home/enock/.codex/skills`. The active Codex skill catalog exposes each skill. Existing installations were reused without replacement or upgrade.

The collection contains `prepare-project`, `project-notes`, `to-spec`, `to-tickets`, `e-mode`, `long-running-work`, `clean-interface`, `review-comments`, `create-verification-skill`, `maintain-verification-skill`, and `show-me-your-work`. The repository-specific `verify-stash` skill remains the verification entry point. `technical-writing` and `unslop` remain available for writing.

`AGENTS.md` records task-specific usage. Backlog is the initial Linear status. Publishing tickets does not authorize implementation. The readiness rule requires explicit approval before agent-picked implementation and must not cause automatic workflow or label creation.

## Setup boundaries

No product behavior, database migration, hosting configuration, or release changed during setup. No test notes or tickets were created to check connector access. The Topics specification and five tickets are actual agreed planning work. The research workspace is ready for future research without placeholder notes.

Local setup verification uses a dedicated disposable PostgreSQL container and schemas. Existing project-owned and other-project database clusters remain untouched. Commands and results are recorded in [the verification log](verification.md). This setup does not prove Topics works, since its implementation is pending, and does not replace the recorded hosting backup and alert limitations.
