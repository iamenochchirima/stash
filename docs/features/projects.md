# Projects

Projects are private workspaces for ongoing research. Enter through Projects in the main navigation or `/projects`. Each project has a name, optional description/repository link and an archive state. No tasks or repository instructions are inferred from saved research.

Project items stay out of the default library, library collections and legacy link tools. Search inside a project, or explicitly enable Include project research in the library search. Main-library notes remain limited to 50,000 characters; project notes and ideas support 500,000. Project drafts are isolated from library drafts. Links and PDFs use the existing private capture, reading, extraction and summary flows.

API and MCP use shared ownership and revision checks. Agents can list/find projects, save with projectId, retrieve documents in 30,000-character chunks and append findings with a revision and retry identity. The last 20 body revisions remain readable. Read-only connections cannot create or append research. Archived projects remain readable; reopen before capturing, editing, restoring or importing new contents. Duplicate import retries do not modify archived contents.

Save to library copies a chosen excerpt or source link and retains a private reference to the project original. It does not move the research or implicitly duplicate a PDF original. Project deletion requires an empty, archived workspace, its current revision and explicit DELETE confirmation. Items in Trash also block deletion. Move research to another open project or deliberately purge its items before deleting the workspace. Account deletion cascades projects/history and uses existing file cleanup.

Limits: 100 projects/account; 200-character names, 4,000-character descriptions; 100 MiB of current project bodies plus retained body history per account. Item and PDF quotas remain account-wide. JSON v3 includes project association, metadata, archive state and body history. Topics are library-only and are preserved in v3 exports. Existing v1/v2 imports remain supported. Full ZIP backup integration is coordinated with the Library v2 release.

Verification recipes: tests/projects.test.ts and tests/browser/projects.spec.ts. Evidence and local/hosted status are recorded in docs/verification.md. Projects is deployed through the coordinated Library v2 release. Dedicated hosted checks passed creation, a long document, scoped reading, append/history, explicit library promotion, account isolation, archived read-only state and mobile overflow. All disposable accounts were deleted. Evidence is docs/evidence/library-v2/hosted-projects.json and hosted-project-mobile.png.


Projects and item readers now share the server-validated workspace session instead of independently deciding whether to render public or private UI. Project query state is supplied by its page so the initial server/client render agrees. Header branding uses the shared brand component. Account/content ownership still lives in the API and shared services.

## MCP project management

Write connections support project creation, metadata updates, archive/reopen and permanent deletion. Existing `save_item`, `update_item`, `list_items`, `search_items`, `get_item`, `archive_item`, `trash_item` and `restore_item` apply to project contents. Use `projectId` when listing or saving. Archive and Trash remain explicit filters.

| Tool | Behavior |
| --- | --- |
| `delete_project` | Deletes only an empty, archived project. Requires current revision and `confirmation: "DELETE"`. |
| `move_project_item` | Moves a project item to another owned, open project using its current revision. Preserves identity, history, original files and summaries. Rejects duplicate destination links, including Trash. |
| `promote_project_item` | Copies a source or chosen excerpt to the main library with a source reference and retry request ID. |
| `restore_project_document` | Restores a retained body revision with a current-revision guard. Keeps the replaced body in history. |
| `project_document_history` | Lists retained revisions or reads one in 30,000-character chunks using offset/nextOffset. |
| `purge_item` | Permanently deletes an item already in Trash after explicit DELETE confirmation. Physical originals use the existing cleanup queue. |

Read-only connections expose none of the mutation tools. All new mutations use the same owner-bound core services as HTTP. Move and restore require open projects. Library copies survive deletion of their project original, with their source reference cleared. Links, notes, ideas and existing PDFs can be managed; PDF binary upload remains in the web flow. Extracted PDF reading and summaries use the existing MCP tools. No bulk project deletion or implicit merging is performed.
