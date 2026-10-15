# Stash library v2 implementation plan

Approved for implementation to completion, 15 October 2026. An active goal tracks the full release. The user requested a substantial upgrade for general ideas and reported that clicking a resource card does not open the saved item. This plan covers the next consumer-library release. IMPLEMENTATION.md remains the original release checklist; ADMIN_IMPLEMENTATION.md remains the separate admin release. On 15 October 2026 the user also selected PDF ingestion and on-demand AI summaries for this release. Unselected features in FEATURE_BACKLOG.md stay deferred.

## Product outcome

Stash becomes a place to capture a useful link, a standalone note, an idea or a PDF during a conversation, open it later, develop its content and retrieve it through another agent. Every saved item has an actual Stash detail page. Existing saved links, collections and agent connections continue to work.

Example journey: an agent finds an article and saves it with context. The user opens its card inside Stash, reads their notes and opens the original source separately. Later, the user captures a business idea without needing a URL, develops it into a longer note, organises it with related research and asks another agent to retrieve it. The user can also upload a PDF, search its extracted text and request a summary of that PDF or a saved article. An accidentally removed item can be restored.

## Confirmed current gaps

- Resource cards are plain article elements. Only their title is clickable, and that anchor opens the external URL. There is no internal saved-item detail route. Clicking the card body has no action.
- Resource creation requires an HTTP(S) URL in the shared schema, database and capture form. Standalone ideas/notes cannot be represented honestly.
- The card shows a shortened preview, while the existing modal is designed for editing. There is no comfortable full-content reading view or direct saved-item URL.
- MCP saves and retrieves link resources. It has no general-item editing workflow.
- Existing deletion is permanent. Archive and recoverable trash do not exist.

## Release scope

| Area | User-visible result |
| --- | --- |
| Four item types | Save Link, Note, Idea or PDF. Links require a source URL; notes/ideas require content; PDFs require an owned uploaded file. |
| Open every card | Clicking the main card area or its title opens the item inside Stash. Open source is a separate action for links. |
| Full item pages | Read full content, edit, organise, copy the private Stash link, favourite, archive or move to trash. Direct URLs survive refresh and sign-in. |
| Fast capture | One Add item action with a Link/Note/Idea/PDF selector and only the necessary fields visible. Support both manual and agent capture. |
| Better retrieval | Search titles, content, extracted PDF text, context and tags. Filter by type, collection, favourites and link reading status. Preserve search/filter/page state when returning from an item. |
| Safe organisation | Keep multiple collections, tags and favourites. Archive hides items from the default library. Trash supports restore and a stated 30-day retention window. |
| Agent workflow | Save and retrieve all item types, update content with conflict protection, archive, move to trash and restore using existing account-bound permissions. |
| PDF ingestion | Upload a text-based PDF, retain its private original, extract searchable text and read it from its item page. Scanned PDFs/OCR stay deferred. |
| AI summaries | Explicit Summarise action for articles and PDFs, with source references, saved results, failure states and enforced usage limits. |
| Data portability | Versioned JSON includes all item content/metadata; a full backup ZIP adds original PDFs. Existing JSON v1 and browser bookmark imports remain supported. |
| Operational compatibility | Existing account separation, suspension/deletion, admin counts, OAuth, agent keys and durable account deletion keep working. |

## Interaction and visual direction

- Keep the approved Stash typography, restrained palette and compact navigation. No new decorative dashboards or promotional copy in the workspace.
- Primary navigation: All items, Favourites, Collections, Archive and Trash. A collection list remains manageable when many collections exist.
- Show a small type icon, title and a short preview on cards. Link cards can show a source domain; notes and ideas must not display a fake domain or reading badge. PDF cards show the filename and processing state only when useful.
- Use a real internal anchor as the main card target, with proper keyboard activation and visible focus. Separate menu/source/edit controls must work without triggering card navigation. Do not nest buttons inside links or add an onClick-only article.
- Canonical private route: /items/[id]. Desktop uses the normal workspace shell with a comfortable content column; mobile uses the full available width. Opening an item does not make it public.
- Detail shows title, item type, full body/context, collection/tag controls and created/updated information. Put secondary metadata and destructive actions out of the reading path.
- Link detail has Open source. Copy Stash link copies the internal account-protected URL. Label the two actions clearly.
- Use a simple Markdown editor and rendered reading view for note/idea bodies. Support paragraphs, headings, lists, links and fenced code. No raw HTML, embedded frames or remote images in this release.
- Explicit Save changes, visible unsaved state and a discard warning protect edits. Do not silently lose a draft on navigation or claim Saved before persistence succeeds. Scope drafts to the current account and clear them on sign-out.
- Keep capture short: link field for Link; content field for Note/Idea. Title can be entered or derived deterministically from content. Collections and tags stay optional. Place additional options behind a disclosure.
- PDF detail shows extracted text with page references and Download original. Keep pending, unsupported, failed and ready states clear. File processing must not block browsing other items.
- Articles/PDFs expose one Summarise action on detail, not a new toolbar of AI controls. Render a short generated summary in its own labelled section, with page/source references and a retry/regenerate action when appropriate. Preserve the original and all user-written notes.
- Before the first summary request, explain which selected source text is sent to the configured AI provider. Generation stays user-triggered; uploading or saving alone never starts paid AI work.
- Empty states say what can be saved and offer the appropriate action. Errors explain what failed and preserve entered content. No invented AI summaries, tags or previews.

## Model and state rules

### Item content

- Keep the existing resources table during migration; Item becomes the product/API term. Avoid a second library with different ownership rules.
- Add kind: link | note | idea | pdf. Backfill all existing rows as link without changing their IDs, timestamps, URLs, notes, tags or collection memberships.
- Make url nullable; enforce a valid nonempty source URL for link items. Notes/ideas use body and do not require a URL. Preserve existing notes as link context; do not overwrite them with generated content.
- Add bounded editable body content for notes/ideas, proposed maximum 50,000 characters. PDF extraction lives separately in bounded page-text records. Keep existing title/context/tag limits unless a tested requirement changes them. Show limits before a failed save.
- Retain unread/reading/done for links and PDFs. The new contract makes reading status inapplicable to notes/ideas. No idea workflow/kanban states in this release.
- Titles fall back to the URL hostname for links, the first nonempty content line for notes/ideas or a cleaned filename for PDFs. No external model/API is required for capture or title fallback.
- Preserve normalised URL uniqueness per account for links. Repeated note/idea text is allowed. An existing URL never silently overwrites saved context or body.
- Use a scoped request ID for retry-safe creates, with a documented expiry. Repeating the same request returns the same result; reusing its ID for different content returns a conflict.
- Track a numeric content revision. Web and MCP updates submit the revision they read; stale writes return a conflict instead of overwriting another edit. Offer reload/review while preserving the unsaved draft.

### PDFs and private storage

- Store originals in private object storage, with account-owned attachment records in PostgreSQL. Do not store binary files in the database or make storage buckets public. Provider/bucket selection and any new storage cost must be settled before provisioning.
- Proposed initial limits: one PDF per PDF item, 20 MiB per file, 100 pages, 250,000 extracted characters and a 30-second extraction deadline. Enforce a per-account stored-byte quota as well as the existing item count. Confirm quota/cost values during implementation setup.
- Validate extension, MIME, PDF signature and actual parser output; never trust filename or browser MIME alone. Reject corrupt/encrypted/password-protected PDFs with useful errors. Image-only PDFs explain that OCR is not supported; retain the original for download without claiming it is searchable or summarizable.
- Process in an isolated, resource-bounded worker with limited concurrency. Do not execute embedded scripts, resolve embedded remote resources or render uploaded active content in the application origin. Original files are served as attachment downloads through authorised access.
- Track uploaded, queued, processing, ready and failed states. Persist page-to-text mapping, content hash, parser version and safe failure codes. Retrying an unchanged completed upload must not duplicate extraction.
- Authorise upload completion, extraction, download and retries against the current account and item state. Use short-lived downloads; never log their URLs. Re-check suspension/deletion before work begins and before results are committed.
- Expire abandoned uploads and clean orphan objects with bounded jobs. File creation failures must not leave uncounted storage or a false ready state. Trash preserves files until restore/expiry; permanent item/account deletion removes originals, derived text and generated summaries.
- Extend durable account deletion to storage cleanup and recovery replay. Keep pending cleanup independently of deleted user rows, so a cascade cannot erase the cleanup instruction. A restored database must not restore access to a deleted account's objects. Document and verify the cleanup deadline and any provider retention/versioning constraints.

### On-demand summaries

- First-version targets are public article text and ready, text-based PDFs. Notes/ideas, automatic summaries on save, suggested tags and OCR remain outside this summarisation scope.
- For articles, fetch/extract source text only on demand with bounded bytes/time and safe HTTP(S) rules on every redirect/resolved address. Block private-network access. Unavailable/paywalled/unsupported sources return a useful failure, not a summary invented from the title.
- Keep the source snapshot or PDF extraction revision and hash used for generation. Bound input/output tokens and chunk long sources within explicit limits; report partial-source coverage rather than silently claiming the entire document was read.
- Treat source text as untrusted data. The summarisation worker has no tools, credentials in prompts or ability to follow instructions embedded in source content. Validate a bounded structured response before saving/rendering it.
- Store summaries separately from user-written content, with source hash/revision, generation time, provider/model identifier and page/section references. Mark an older summary stale when its source changes. Regeneration replaces only the generated result after success; failure preserves the previous result and user notes.
- Use durable queued/running/succeeded/failed/cancelled jobs with bounded retries, idempotency and timeouts. Prevent duplicate concurrent jobs and repeated provider charges where the provider supports idempotency. Stop retries on permanent errors, quota exhaustion, suspension or deletion. Cancel queued work and attempt to cancel in-flight requests; already-dispatched calls may still incur provider charges, but their results must not be committed after account deletion.
- Choose one AI provider/model for the first release, with documented data-retention/privacy terms, host-managed credentials, a per-account request/token quota, concurrency limits and a global spending cap. Reserve quota atomically before dispatch and reconcile actual usage. If a provider call has an unknown outcome, record it and do not blindly retry/charge again.
- Do not claim readiness when the provider is unconfigured. Show generation unavailable while preserving the rest of the library. Real provider acceptance and an agreed usage budget remain required release checks; stub-only tests do not complete this feature.
- Admin visibility stays operational: configured/unconfigured, processing failures, quotas and aggregate usage/cost. Do not expose documents, prompts or summaries in admin screens/logs. Reuse existing admin authorisation for any operational controls; never put provider keys in browser configuration.

### Organisation and recovery

- Favourite is independent of type, reading status and archive state. Preserve existing many-to-many collections.
- archivedAt hides an item from default lists but keeps it in Archive and explicit-ID retrieval. Default agent searches exclude archived items unless asked to include them.
- deletedAt means Trash. Trashed items are excluded from normal detail/search and agent retrieval; only explicitly authorised trash views/restoration can expose them. UI offers Restore and Delete permanently.
- Trash retention is 30 days from deletion. Restore before expiry clears deletedAt and returns to the previous archive state. Repeated move/restore operations are safe to retry.
- A scheduled job permanently removes expired trash and records only safe operational results. Deploy/verify the worker and its retry behaviour; a timestamp alone is not a purge implementation.
- A trashed duplicate URL produces an explicit restore-or-delete conflict, never a new hidden duplicate. Restoring cannot overwrite a newer existing item.
- Account deletion immediately removes access to all active, archived and trashed content and schedules durable deletion of their stored files/derived content through the existing durable deletion-journal flow. Trash does not delay account deletion or permit deleted content to reappear after restore.
- Existing 10,000-item account limit counts retained active/archived/trashed items until permanent deletion. State this clearly in limits/errors.

## API, MCP and compatibility

- Use the same ownership-scoped core library services for the web API and MCP. All item IDs, collection IDs, request IDs and revisions are bound to the authenticated account.
- Add /api/items as the mixed-type contract with paginated list/search, detail, create, edit and explicit lifecycle actions. Keep /api/resources as a tested links-only adapter for existing clients. Old clients must never receive null URLs and crash.
- Add general-item MCP tools: save_item, get_item, list_items, search_items, update_item, archive_item, trash_item and restore_item. PDF uploads use the authorised web/upload API; do not accept arbitrary local filesystem paths through remote MCP. Agents can retrieve bounded extracted text/page ranges and stored summaries from owned PDF items. Add explicit summarise_item and get_processing_status tools; paid generation requires write permission and the same quotas as the web action. Shared collection tools remain. Archive/unarchive uses an explicit target state.
- Preserve legacy resource tools as links-only compatibility operations. Their existing request shapes and duplicate semantics remain valid. Mark them clearly as link tools in descriptions; prefer item tools for new flows.
- Preserve the existing permanent-deletion meaning of the legacy delete_resource tool for links, and document it. New trash_item is explicitly recoverable. Do not silently change what existing tools promise.
- Read-only credentials may only list/search/read permitted content. Existing write credentials may save, edit and manage lifecycle. No new credential scope or access to another account is implied.
- List/search results contain bounded previews rather than entire 50,000-character bodies. get_item returns the requested full content. Limit pagination and response sizes.
- Return saved text as untrusted reference material. Preserve the current MCP notice and reject unsafe renderable URL schemes/HTML in the web client.
- Preserve manual keys, OAuth issuer/resources, consent, refresh rotation, revocation and suspension checks. The library upgrade must not require reconnecting existing agents.
- JSON v2 stores kind/body/context, extracted text, generated summaries with provenance, organisation, timestamps and state. JSON alone is explicitly labelled as excluding original PDF binaries. A full backup ZIP contains the v2 manifest and owned originals with checksums; import validates paths, formats, declared/actual sizes and bounded decompression before restoring files. Never export internal storage keys, signed URLs or provider secrets. Restore v1 as links. HTML bookmark export includes links only and reports omitted notes/ideas; it must not silently present an incomplete full backup.
- Admin screens remain metadata-only. Update counts for item types and lifecycle states without exposing bodies, titles, URLs or context. Preserve admin privacy and audit contracts.

## Implementation checklist

### V1 Open and read saved items

- [x] V1.1 Build a protected /items/[id] detail route with workspace navigation and private not-found handling.
- [x] V1.2 Make card main areas/title navigate internally; provide separate source and menu controls.
- [x] V1.3 Preserve library filters, pagination and scroll when returning. Support direct links, refresh and safe return after sign-in.
- [x] V1.4 Show all existing link context; support existing edit/delete actions without losing list state.
- [x] V1.5 Verify keyboard, text selection, nested controls, mobile navigation and wrong-account IDs.

Acceptance: the exact reported card issue is fixed. Card body/title opens the saved Stash item; Open source alone opens the external site. Direct links never bypass account ownership.

### V2 General items and migration

- [x] V2.1 Add migration, database constraints/indexes, kind/body/lifecycle/revision fields and shared validation.
- [x] V2.2 Backfill link rows without changing existing data. Preserve prior migrations and ownership/membership constraints.
- [x] V2.3 Add mixed-type services and /api/items plus the legacy links-only adapter.
- [x] V2.4 Extend full-text indexing to body/context/tags and reindex existing rows safely.
- [x] V2.5 Add bounded retry-safe create and optimistic edit conflict handling.
- [x] V2.6 Verify malformed/oversized content, concurrent saves/edits, duplicate links and database constraints.

Acceptance: an account can create URL-free notes/ideas and retrieve them through the real API. Older clients remain compatible and existing link records are unchanged.

### V3 Capture, editor and organisation

- [x] V3.1 Build the type-aware Add item form, deterministic title fallback and account-scoped draft protection.
- [x] V3.2 Render safe full content and explicit editing states. Support conflict recovery without discarding typed content.
- [x] V3.3 Add compact type-aware cards and filters for type/collection/favourites/link-or-PDF reading status.
- [x] V3.4 Implement favourite and archive/unarchive actions, counts and empty states.
- [x] V3.5 Verify all operations persist after refresh and across separate browser sessions.
- [x] V3.6 Inspect desktop/mobile screenshots and review the UI for duplicate labels, unnecessary fields and visual noise.

Acceptance: a user can quickly capture an idea, reopen and develop it, organise it with link research and find it again without manufacturing a URL.

### V4 Recovery and portability

- [x] V4.1 Implement Trash, restore, permanent deletion and explicit confirmation/undo feedback.
- [x] V4.2 Implement 30-day purge processing with bounded batches, retry/race protection and deployment scheduling.
- [x] V4.3 Preserve account-deletion journal/cascade semantics for every item state and pending draft.
- [x] V4.4 Add JSON v2 export/import and v1 compatibility, preserving all item types, memberships and state.
- [x] V4.5 Keep bookmark import/export honest about its links-only scope.
- [x] V4.6 Verify restore/duplicate conflicts, purge boundaries and re-import into an isolated account.

Acceptance: accidental deletion is recoverable before expiry; expired trash is actually purged; full export/import preserves note/idea content and organisation; account deletion removes everything immediately.

### V5 Agent support and admin compatibility

- [x] V5.1 Add mixed-item MCP schemas/tools, bounded previews and explicit lifecycle actions.
- [x] V5.2 Verify legacy tools/request shapes and read-only/write permissions.
- [x] V5.3 Verify two independently connected clients can save/retrieve/edit the same account's items safely, including revision conflicts.
- [x] V5.4 Update agent setup/help and tool descriptions with URL-free examples and clear archive/trash behaviour.
- [x] V5.5 Update admin counts/metadata responses and account lifecycle behaviour without exposing private content.

Acceptance: an agent can save an idea without a URL, another can retrieve/update it, and both remain constrained by account ownership and scopes. Existing link clients continue to work.

### V6 PDF capture and processing

- [x] V6.1 Select private object storage, agree on storage quota/cost and add required attachment/extraction/job migrations.
- [x] V6.2 Implement authorised upload/complete/download, size/content checks, abandoned-upload cleanup and per-account byte accounting.
- [x] V6.3 Implement isolated extraction with deadlines/concurrency/page-text mapping, durable states and retry controls.
- [x] V6.4 Build PDF capture/detail, useful failure states, text/page reading and Download original; integrate extracted text with search and bounded MCP retrieval.
- [x] V6.5 Extend archive/trash/purge, account deletion/journal replay and orphan cleanup to stored files and derived content.
- [x] V6.6 Implement full PDF backup ZIP export/import and explicit JSON-only limitations.
- [x] V6.7 Verify hostile/malformed/oversized/encrypted/image-only fixtures, ownership, quota races, worker restarts, storage outages and deletion during processing.

Acceptance: upload a real text PDF, refresh, read/search its extracted content and download the identical original. Other accounts cannot access it. Unsupported files fail honestly; deleted files do not survive indefinitely as untracked objects.

### V7 On-demand AI summaries

- [x] V7.1 Choose the provider/model and agree on request/token quotas, global budget and source-disclosure copy. Configure credentials privately.
- [x] V7.2 Implement safe article extraction and revision-bound PDF source access with input/page/response limits.
- [x] V7.3 Implement durable jobs, structured outputs, source references, atomic quota reservation, usage reconciliation, cancellation and bounded retries.
- [x] V7.4 Add the explicit Summarise action, saved/stale summaries, progress, unavailable/error states and regeneration that preserves user content.
- [x] V7.5 Add write-scoped summarise_item/status MCP flows and safe operational admin status/usage counts.
- [x] V7.6 Verify source grounding on a small labelled article/PDF set, partial-source disclosure, stale content and prompt-injection fixtures.
- [x] V7.7 Verify timeouts, rate limits, budget exhaustion, duplicate requests, ambiguous provider failures and cancellation/account deletion races.
- [x] V7.8 Run real provider acceptance on disposable sources within the agreed budget, recording usage and content/provenance quality without exposing private text.

Acceptance: a user explicitly requests an article/PDF summary, receives a concise source-grounded result with references, can revisit it and regenerate it safely. No notes are overwritten, paid work stays within limits and real-provider acceptance has passed.

### V8 Release and hosted acceptance

- [x] V8.1 Run focused integration/browser/security tests, pnpm typecheck and all production builds, including admin and processing workers.
- [x] V8.2 Verify migration on a representative disposable copy and prepare a rollback-compatible deployment sequence.
- [x] V8.3 Deploy schema/API with new item creation gated off, then the compatible consumer client, extraction/summary/purge workers, private storage configuration and necessary admin updates. Verify before enabling new item types. Keep old-contract links-only adapters available for cached clients.
- [x] V8.4 Define rollback after activation: disable new writes and use the last mixed-item-aware artifact. Do not roll back to a URL-required server or destructively revert the migration once notes/ideas exist.
- [x] V8.5 Run hosted disposable-account acceptance for link/note/idea/PDF capture, original-file download, searchable extraction, real AI summary generation, direct-card navigation, search, agent retrieval, archive/trash/restore and complete account deletion.
- [x] V8.6 Verify real available agent clients separately from SDK tests; record client/version and any unavailable acceptance checks.
- [x] V8.7 Update docs/features, canonical verification skill, operations, verification evidence and decisions. Review metrics and privacy before marking complete.

Acceptance: the consumer client, API, MCP, admin integration, private object storage and extraction/summary/purge workers are deployed and verified. Failed/unavailable checks stay pending, and test accounts are cleaned up. No hosting-plan upgrade is implied.

## Required verification

| ID | Evidence required |
| --- | --- |
| LT01 Card navigation | Card body/title and keyboard activation open internal detail; source/menu/edit actions do not trigger it. Back/forward, refresh, sign-in return, deleted/missing/wrong-account IDs and mobile work. |
| LT02 Migration | Existing link IDs, content, URLs, timestamps, ownership and memberships survive. Prior application contracts receive valid link-only data. |
| LT03 Capture and edits | Each type validates correctly; missing URL for notes/ideas succeeds; empty bodies/unsafe URLs/oversized data fail. Drafts survive recoverable failures and never leak between accounts. |
| LT04 Concurrency | Duplicate link races, request retries, request-ID payload mismatch, conflicting revisions and archive/trash/restore/purge races have deterministic outcomes without lost content. |
| LT05 Search and organisation | Body/context/tag search, per-account counts, filters, pagination, favourites and archive states match persisted records and preserve navigation state. |
| LT06 Content safety | Script/HTML/unsafe-link fixtures do not execute, remote images are not fetched and saved prompt-like content remains untrusted reference data. |
| LT07 Privacy and credentials | Foreign users cannot read/search/edit/restore/delete or attach another account's collection. Read-only keys/OAuth grants cannot mutate. Suspension/reset/revocation/account deletion deny access through old and new contracts. |
| LT08 Recovery | Restore before expiry, rejection after expiry, actual scheduled purge, duplicate-URL conflict, immediate account deletion and deletion-journal restore replay cover every item state. |
| LT09 Portability | JSON v2 round-trip preserves complete content/organisation; v1/bookmarks still import; HTML omissions are reported; malicious ownership fields are ignored/rejected. |
| LT10 MCP compatibility | SDK tests cover every item tool, legacy link tools, expired/revoked credentials, two clients and stale edits. Real client acceptance is recorded separately. |
| LT11 UI quality | Desktop/tablet/mobile screenshots; keyboard/dialog focus, axe checks, text wrapping, long content, loading/empty/errors, save feedback and reduced motion. |
| LT12 Operations and regression | API/MCP/customer/admin suites pass. Admin metadata remains private-content-free; counts and account lifecycle include new states. Worker, TLS, migration/deployment order and hosted disposable-account cleanup are verified. |
| LT13 PDF processing | Signature/parser checks, limits, encrypted/scanned/corrupt files, isolated workers, page mapping/search, duplicate retries, quota races, storage outage, cross-account downloads and orphan cleanup. |
| LT14 Summary generation | Safe article fetching, source/page grounding, prompt-injection resistance, input/output limits, partial coverage, stale revisions, user-note preservation, provider failures, unknown outcomes, job idempotency and atomic quotas/budget. Both isolated boundary tests and real-provider acceptance are required. |
| LT15 File/AI lifecycle | Trash/restore/purge, full backup ZIP round-trip, bounded decompression/path validation, item/account deletion during processing, storage cleanup after journal replay, cancellation of paid work and admin content redaction. |

Use disposable PostgreSQL schemas for automated tests, never live user data. Record commands, environments, revisions and actual results in docs/verification.md. Preserve sanitised screenshots/reports in docs/evidence. Checkbox completion requires working behaviour plus its evidence, not just a new screen.

## Scope decisions and deferred work

The user approved adding text-based PDF ingestion and on-demand article/PDF summaries to the proposed links/notes/ideas, plain Markdown editor, favourites, archive and 30-day trash release. The user selected Backblaze private storage (credentials supplied and synthetic provider checks passed on 15 October) and OpenRouter using credentials from the Lina project. Approved alpha limits are 500 MiB per account and 5 GiB globally including pending deletion. Summaries use cohere/north-mini-code:free through OpenRouter with a $0 cap and paid fallback rejected. The user authorised implementation to completion; preserve these agreed defaults while resolving provider/storage configuration. The first deliverable is card navigation/detail, so the reported issue is addressed early rather than waiting for every feature.

Automatic summaries on save, suggested tags, OCR, non-PDF attachments, semantic/vector search, browser extensions, shared collections, public profiles/publishing, automatic conversation ingestion, rich block editors, idea kanban boards and cross-item knowledge graphs remain outside this chunk. A note can contain pasted text or code, but there is no automatic client conversation import or dedicated snippet type.

Implementation started at the user's request. Execute the checklist in order and keep partial/unverified items visible until the full release works end to end. Do not mark external storage/provider acceptance complete until it runs against the configured services.

## Progress checkpoint, 15 October 2026

The local foundation has 15 focused integration tests and 10 browser journeys passing, plus typecheck and all production builds. Evidence is in docs/evidence/library-v2. The first browser run exposed mobile navigation overflow and a selector-label mismatch; a later aggregate run hit the default global rate limit. These were corrected and the full focused browser set passed. The harness uses a larger global ceiling for rapid combined journeys; production and authentication/MFA limits are unchanged. A populated pre-upgrade migration fixture passed.

Checked items above refer to the non-PDF foundation only. PDF extraction/storage, PDF backup, summary generation, file-aware deletion/recovery, admin metadata adaptation and final hosted/client acceptance remain unfinished. No v2 changes have been pushed or deployed.


### PDF checkpoint, 15 October 2026

V6.2–V6.4 are implemented locally. Real B2 synthetic acceptance verified private ACL, upload, identical original download and deletion of all versions. Consumer PDF upload/read/download/edit flows passed at desktop/mobile widths with accessibility checks. Integration checks cover malformed, encrypted, oversized and no-text inputs, quota reservation races, expired uploads, worker lease recovery, storage outages, account deletion and bounded MCP reads. Storage defaults are 500 MiB per account and 5 GiB globally, including pending uploads. Two global uploads and one extraction job are allowed concurrently. These conservative defaults do not provision or upgrade a hosting/storage plan.

V6.1 remains unchecked pending final operational quota/cost documentation and rollout. V6.5–V6.7 remain unchecked for journal/recovery coverage, ZIP backup, deletion-during-processing and broader concurrency/security acceptance. V7 summaries and V8 deployment remain pending. Credentials supplied in root files are excluded from source control and deployment contexts. No v2 code has been pushed or deployed at this checkpoint.


### Summary checkpoint, 15 October 2026

V7.1–V7.5, V7.7 and V7.8 are implemented and verified locally. The selected OpenRouter model is cohere/north-mini-code:free, with a $0 cap and paid models/fallbacks rejected. Defaults are five requests per account/UTC day, 300,000 reserved tokens per account/day, 100 requests globally/day and 1,000 globally/month. No paid inference or plan upgrade was authorised or performed. Provider routing/privacy limits are documented in docs/summary-processing.md.

The real-provider acceptance set passed a complete local PDF upload/extraction/job/result flow, a public RFC article source and a prompt-injection fixture, all with reported $0 usage. Browser journeys use a separate provider test double and passed at desktop/mobile widths. They are not a substitute for the real-provider check. Admin aggregation and SDK scope/account boundaries were verified without exposing content. Request aliases survive completion, and known changed article content marks an older result stale even if regeneration fails.

V7.6 remains unchecked pending the final partial-coverage browser case and broader labelled acceptance review. Full backup ZIP, derivative JSON round-trip, file-aware recovery verification, draft/undo refinements, full regressions, native-client checks, deployment and hosted acceptance remain open. This checkpoint does not complete the release goal. No Library v2 commit has been pushed or deployed.


Backup checkpoint, 15 October 2026: complete PDF/summary data-only JSON roundtrip and missing-original reading are locally verified. Full ZIP export now streams through session-bound one-use grants and a separate memory-only browser worker. Archive validation covers indexes, traversal, symlinks, checksums, bounded expansion and the legal maximum project body plus 20 prior bodies. Download/extraction reject changed originals, and queued deletion bytes stay charged until actual cleanup. Four focused backup route/archive tests, three later archive capacity cases, seven PDF checks, the real browser download/data-only restore journey, root typecheck and all production builds passed. Evidence is under docs/evidence/library-v2/backup-*.txt and pdf-integrity.txt. Full ZIP restore remains unfinished, so V6.6 stays unchecked. No Library v2 or Projects changes have been pushed or deployed.


Full ZIP restore checkpoint, 15 October 2026: V4.4 and V6.6 are now locally verified. All original and derived item content, collection memberships, project history/source links, summary provenance and lifecycle states roundtrip without claiming missing files or overwriting later edits. ZIP validation precedes import in the browser and is repeated on each direct API request. Retry is durable and scoped to the account/session; original adoption is atomic. Evidence includes 26 combined backup/PDF/project tests, five final restore lifecycle tests, seven JSON v1/v2/legacy checks, two desktop/mobile browser journeys and a real Backblaze two-account byte-exact roundtrip with all-version cleanup. Root typecheck passed. Root typecheck and all API/consumer/admin production builds passed. Native-client checks, remaining recovery/draft/bookmark/summary coverage and coordinated hosted deployment still remain; the goal is not complete. Local additive migrations through 0020 are frozen and applied to 127.0.0.1:55432/stash only.


Export/help checkpoint, 15 October 2026: V4.5 and V5.4 are locally verified. Bookmark HTML contains owned main-library link titles and URLs, includes archived links, excludes Trash/project research and all non-link content, escapes text/attributes and reports omitted counts before and inside the download. JSON and bookmark downloads now use the same session-bound direct API path as ZIP, with incremental output and no private worker caching. A multi-megabyte JSON test checks bounded per-item chunks. Agent help includes URL-free save/find examples, explicit archive/Trash and project scope, PDF reading and current backup behavior. Eight export/ZIP/MCP tests, eight final streaming/backup tests and the real mobile export plus complete account browser journey passed. Root typecheck and API/consumer/admin production builds passed. Local migration 0021 is frozen/applied only to development. Remaining draft verification must include changing accounts in another tab before saving an old draft, explicit discard and conflict recovery. These items remain unchecked until demonstrated. No v2/Projects push or deployment has occurred.


Draft, recovery and quality checkpoint, 15 October 2026: account-scoped drafts now survive close/reload and recoverable conflicts, support explicit discard and remain usable when browser storage is full. Account changes reject stale-tab writes; sign-out, reset and deletion clear drafts and notify other tabs. Actual text selection, nested card controls, mobile navigation, lifecycle Undo and permanent-delete confirmation passed browser checks. The user explicitly confirmed 500 MiB per account and 5 GiB global PDF limits including pending deletion.

The independent storage journal records write/removal intent and removal acknowledgement before accepting traffic. A real disposable PostgreSQL dump/restore drill now tracks and removes all three originals, including a PDF uploaded after the snapshot. Parser tests cover 100/101 pages, text limits, image-only/encrypted/malformed files and item/account deletion during extraction. Prompt v3 passed a manually reviewed labelled article/PDF/injection set at reported $0 cost; browser checks show partial coverage and scanned-PDF failure honestly. Full integration passed 108 tests, root typecheck and all production builds passed. These are local results. Native-client acceptance, representative migration/rollback preparation, final browser release matrix and backend-first hosted deployment remain open. Migration 0022 is frozen/applied only locally. No Library v2 or Projects changes have been pushed or deployed.

Release preparation checkpoint: final admin/OAuth/PWA browsers and 10,001-link migration passed. Real Codex 0.162.1 to OpenCode 1.18.35 idea save/retrieve and revocation passed after fixing nullable unused MCP filters. Typecheck/build were repeated successfully. Rollout and post-activation rollback are recorded in docs/library-v2-rollout.md. Railway provider values are staged privately with the feature gate off. V8.3, V8.5 and V8.7 remain open; production application code is unchanged.

Hosted application acceptance passed on activated a1c32f9. The final import-gate-only backend patch e514960 is live through Railway afc42040-d19e-4074-ad84-9dad32ce87c6 with the compatible Vercel clients. Real verification email, mixed capture, internal navigation, searchable extraction, identical original bytes, real summary, MCP retrieval, archive/trash/restore and full ZIP restore into another account passed. Both accounts were deleted. Dedicated hosted Projects checks also passed and cleaned up. Physical originals remain queued until 10:33:57 UTC; V8.5 and the goal stay open until all-version deletion is checked. GitHub CI was prevented from starting by account billing; local checks remain the verification evidence.


Release complete, 15 October 2026: every Library v2 checklist item has implementation and evidence. Final hosted cleanup passed after the normal deletion delay: seven disposable fixture accounts are gone, with zero remaining owned resources, attachments, projects/history, jobs, summaries or cleanup tasks. All three tracked file keys have removal acknowledgements and Backblaze reports zero object versions/delete markers. One hosted summary reported $0. The persistent storage journal survived backend redeployment. Final source e514960 is live on Railway afc42040-d19e-4074-ad84-9dad32ce87c6; consumer/admin production deployments remain READY at compatible source 722db70 because later commits changed backend/scripts/docs only. Full local integration is 108 passing tests; typecheck, production builds, focused browsers, native clients and hosted acceptance passed. GitHub CI could not start due account billing; automated production backups and external alerts remain documented alpha limitations. No plan upgrade occurred. Evidence is docs/evidence/library-v2 and docs/verification.md.
