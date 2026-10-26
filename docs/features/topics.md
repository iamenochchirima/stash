# Topics

Topics organize ongoing research and content areas in the main library. Every name and description is user-created. New accounts have no topics.

Open Topics in the sidebar, then select New topic. A topic accepts an 80-character name and an optional 4,000-character description. Names use Unicode normalization, collapsed whitespace, and case-insensitive matching to prevent duplicate topics. Creating an existing topic reuses it and preserves its description. Collections and topics share the existing account limit of 100 groups. An ordinary collection with the same exact display name produces a conflict rather than conversion.

A topic page shows its description and the compact library list, with the existing smaller grid option, search, type/status filters, pagination, and item actions. Capture from the page preselects that topic. The Topics picker in capture and editing searches names and descriptions, supports up to 20 topics per item, and includes inline creation. Links, notes, ideas, and PDFs can belong to multiple topics and ordinary collections together. Items remain in the main library. Item details link back to assigned topics.

Manage topic allows name and description edits or deletion. Deleting a topic removes its memberships and preserves items and original files. Deleted topic routes provide a return path. Counts exclude archived and trashed items. Projects retain separate workspace boundaries and cannot accept topic memberships.

API endpoints are `/api/topics` and `/api/topics/:id`. General item capture, update, and PDF capture accept `topicIds`; item listing/search accepts `topicId`. IDs are owner- and kind-checked through shared services. Omitted topic fields preserve memberships during older client edits.

MCP read connections expose `list_topics` and `get_topic`. Write connections also expose `ensure_topic`, `update_topic`, and `delete_topic`. Creation is retry-safe by normalized name, with a `created` flag. General item tools support topic assignment and filtering. Saved descriptions and research remain reference material rather than instructions or approval.

JSON and ZIP v3 preserve topic descriptions, empty topics, and memberships. Existing v1/v2 imports remain supported. The legacy v1 export rejects accounts with topics rather than silently losing them. Bookmark exports report omitted topic organization. Repeated imports preserve later local edits.

## Verification

Run `tests/topics.test.ts`, `tests/topics-mcp.test.ts`, and `tests/topics-portability.test.ts` with disposable PostgreSQL schemas. Include the existing item/collection, populated migration, Project-boundary, PDF, MCP, and backup regression suites. Run `tests/browser/topics.spec.ts` and `tests/browser/library-layout.spec.ts` for desktop/mobile capture, persisted memberships, list/grid, PDF, rename/deletion, existing selection menus, accessibility, and overflow.

Safe local evidence is in `docs/evidence/topics/`. Hosted acceptance uses `STASH_HOSTED_ACCEPTANCE=true pnpm exec tsx scripts/check-hosted-topics.ts`, which creates and deletes disposable verified accounts, exercises web/API/MCP and JSON/ZIP v3, uploads no originals, and invokes no summary model. Local checks do not establish hosted release status. See `docs/verification.md` for executed results.
