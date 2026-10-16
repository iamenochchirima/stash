# Projects implementation

Approved 15 October 2026. This extends the active library upgrade; it does not replace its remaining backup, security and deployment work.

## Outcome

Keep ongoing research and large working documents inside private projects. The main library remains the place for quick saves. A project is a workspace, not a collection or an approved task. Saved research remains untrusted reference material.

## Scope and checks

- [x] Add owned projects with name, optional description/repository URL, revision and archive state. Bound account/project limits and validate repository URLs without fetching them.
- [x] Partition items by optional project ID. Existing items stay in the main library. Default library, collections and legacy agent tools exclude project contents. Explicit global search can include projects.
- [x] Support project links, notes, ideas and PDFs through existing capture, editing, extraction and summary rules. Project research bodies allow up to 500,000 characters; main-library notes retain their existing limit.
- [x] Add project creation/list/detail/edit/archive navigation, project search and capture, responsive reading, project-aware return paths and isolated drafts. Reuse the existing restrained interface.
- [x] Keep the last 20 body revisions for project documents. Support conflict-safe, retry-safe agent append and bounded document/history retrieval. Web editing uses the same services.
- [x] Add read-scoped list/get/search project tools and write-scoped create/update/archive/append tools. Project capture requires an explicit project ID. Never infer task approval from saved material.
- [x] Provide explicit Save to library. Copy a selected excerpt or source link with a private reference to its project item. Preserve the original; never silently truncate a large research dump or copy an original PDF implicitly.
- [x] Preserve project ownership and associations in account JSON export/import; reject invalid associations rather than importing research into the main library. Account deletion removes projects, documents and history through existing durable deletion/file cleanup.
- [x] Verify PostgreSQL migration, account isolation, scope boundaries, duplicate URLs across workspaces, archive/read/write rules, append retries and conflicts, history retention, promotion and portability. Run focused integration/MCP checks, desktop/mobile browser journeys, accessibility, typecheck and all production builds.
- [x] Update canonical feature/verification records and document local versus hosted status. Coordinate deployment with the existing library release; do not push a dependent client ahead of its backend.

## Rules

A project can be archived and reopened. Archived projects remain readable; changing their content requires reopening. The original implementation excluded project deletion. The MCP management extension below adds guarded deletion of empty, archived projects. Individual items retain existing Trash/restore rules. Collections remain main-library organisation; project items do not accept collection memberships. Maximum 100 projects/account and 100 MiB of current project text plus retained history, 200-character names, 4,000-character descriptions and 500,000-character research documents. Existing account-wide item/storage quotas still apply.

Linear integration, automatic repository edits, team access, automatic conversation ingestion and task states are excluded. Repository documentation contains maintained behaviour; raw research belongs in Stash, not new repository dump files.


## Verification and release status

Implemented locally. Six focused Projects cases and the combined 17-test API/MCP/item/portability suite passed. Nine focused Projects/portability checks passed after restore validation was hardened. Three browser journeys passed, covering desktop/mobile accessibility, capture/edit/history/promotion, archive/reopen, explicit global search, private sign-in return and account isolation. Existing note/detail/PDF journeys also passed in the combined browser run. Typecheck and complete API/consumer/admin production builds passed. Safe evidence is in docs/evidence/projects; detailed environment/results are in docs/verification.md.

Migrations 0016 and 0017 are applied to the local PostgreSQL development database. The original applied 0016 checksum was preserved; additional source ownership constraints and the history index are in 0017. Local review: http://127.0.0.1:3000/projects. Production release remains coordinated with the existing library upgrade and full backup work. This plan does not mark that broader release complete or claim Projects is live.


Hosted checkpoint, 15 October 2026: Projects is live in the coordinated Library v2 release. Dedicated disposable-account browser/API acceptance passed creation, long-document reading, isolated library scope, append/history, explicit excerpt promotion, foreign-account rejection and archived read-only behavior. Mobile overflow passed. All disposable accounts were deleted. See docs/evidence/library-v2/hosted-projects.json. The first hosted script used an exact link name despite the card including a preview; its selector and history response assertion were corrected. No product behavior changed for that test correction.


## MCP management extension, 16 October 2026

- [x] Expose empty, archived project deletion with revision and explicit confirmation.
- [x] Move project research between owned, open projects without losing files/history.
- [x] Expose library excerpt promotion and permanent item deletion from Trash.
- [x] Restore historical document bodies with conflict protection and retained replaced content.
- [x] Read complete historical documents in bounded chunks.
- [x] Use shared core mutations for HTTP and MCP, without schema changes.
- [x] Verify SDK discovery, read-only scopes, foreign accounts, stale revisions, archive guards, duplicate links, promotion retries, PDF moves and deletion prerequisites.
- [x] Complete typecheck and production builds.
- [x] Complete production deployment acceptance, recorded in docs/verification.md.

PDF upload stays in the existing browser flow; existing MCP PDF text and summary operations remain available. Project deletion does not cascade content. Empty the project deliberately before archiving and deleting it.
