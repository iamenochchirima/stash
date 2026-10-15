# Projects

Projects are private workspaces for ongoing research. Enter through Projects in the main navigation or `/projects`. Each project has a name, optional description/repository link and an archive state. No tasks or repository instructions are inferred from saved research.

Project items stay out of the default library, library collections and legacy link tools. Search inside a project, or explicitly enable Include project research in the library search. Main-library notes remain limited to 50,000 characters; project notes and ideas support 500,000. Project drafts are isolated from library drafts. Links and PDFs use the existing private capture, reading, extraction and summary flows.

API and MCP use shared ownership and revision checks. Agents can list/find projects, save with projectId, retrieve documents in 30,000-character chunks and append findings with a revision and retry identity. The last 20 body revisions remain readable. Read-only connections cannot create or append research. Archived projects remain readable; reopen before capturing, editing, restoring or importing new contents. Duplicate import retries do not modify archived contents.

Save to library copies a chosen excerpt or source link and retains a private reference to the project original. It does not move the research or implicitly duplicate a PDF original. Project deletion is excluded; archive the workspace or use individual item Trash/restore. Account deletion cascades projects/history and uses existing file cleanup.

Limits: 100 projects/account; 200-character names, 4,000-character descriptions; 100 MiB of current project bodies plus retained body history per account. Item and PDF quotas remain account-wide. JSON v2 includes project association, metadata, archive state and body history. Existing library-only exports remain valid. Full ZIP backup integration is coordinated with the Library v2 release.

Verification recipes: tests/projects.test.ts and tests/browser/projects.spec.ts. Evidence and local/hosted status are recorded in docs/verification.md. Projects is deployed through the coordinated Library v2 release. Dedicated hosted checks passed creation, a long document, scoped reading, append/history, explicit library promotion, account isolation, archived read-only state and mobile overflow. All disposable accounts were deleted. Evidence is docs/evidence/library-v2/hosted-projects.json and hosted-project-mobile.png.


Projects and item readers now share the server-validated workspace session instead of independently deciding whether to render public or private UI. Project query state is supplied by its page so the initial server/client render agrees. Header branding uses the shared brand component. Account/content ownership still lives in the API and shared services.
