# Topics implementation plan

Status: agreed design, implementation pending. Created 26 October 2026.

Topics are ongoing areas of research and content creation. Users and write-authorized agents create them as needed. No topic names, descriptions, or memberships are seeded or hard-coded.

## Product scope

- A topic has an ID, a name, an optional description, and creation and update timestamps.
- An item can belong to several topics and existing collections at the same time. Topic membership does not duplicate the item or remove it from the main library.
- Topics support the existing library item types: links, notes, ideas, and PDFs.
- A topic page shows its description and the existing compact list, with the smaller grid option and current search, filters, pagination, and item actions.
- Users can create, rename, describe, and delete topics. Deleting a topic removes its memberships and preserves all items and original files.
- Agents can discover topics, create or reuse a topic, and attach or detach topics through shared item services.
- Projects retain their existing workspace boundaries. This release attaches topics to main-library items. Project items remain excluded from collection and topic membership.

Topics describe ongoing subject areas. Projects hold work toward a specific outcome. Tags remain lightweight labels. Existing collections, including Inbox, retain their behavior.

Automatic classification, background agents, content calendars, topic hierarchies, merging topics, aliases, project-topic associations, and seeded topics are outside this release.

## Implementation sequence

Complete each phase with focused checks and a local commit. Leave each box unchecked until its acceptance criteria pass. Implementation and release are separate from this planning change.

### 1. Extend the existing organization model

- [ ] Add a discriminator such as `kind: collection | topic` and an optional description to `collections` in `packages/db/src/schema.ts`. Reuse `resource_collections` for membership.
- [ ] Add an additive PostgreSQL migration. Existing rows default to `collection`; IDs, names, memberships, and Inbox remain unchanged. Add update timestamps without rewriting existing identities.
- [ ] Define topic input, output, and filter schemas in `packages/shared`. Proposed limits are 80 characters for names and 4,000 for descriptions. Keep the existing combined limit of 100 organization groups per account for this release.
- [ ] Define one canonical topic-name normalization function: trim, collapse whitespace, apply Unicode normalization, and compare without case sensitivity. Store the display name separately from the normalized key.
- [ ] Enforce unique normalized topic names per owner in PostgreSQL. Serialize quota checks and handle concurrent creation through the database constraint.
- [ ] Preserve existing collection uniqueness and semantics. If a topic name conflicts with an existing collection under the current database constraint, report that conflict. Do not silently convert or rename the collection.

Acceptance: migrate an account with existing collections and memberships, then confirm every ID and association remains intact. A fresh account has no topics. Concurrent requests for equivalent topic names produce one owned topic. Different accounts can use the same name.

### 2. Add shared services and browser API support

- [ ] Add owned topic list, get, create-or-reuse, update, and delete operations in `packages/core`. Keep topic and collection queries explicit so existing collection clients do not unexpectedly receive topics.
- [ ] Make create-or-reuse return the topic and a `created` flag. Reusing a name must not overwrite its description. Description and name changes require an explicit update.
- [ ] Add `topicIds` to main-library item capture and editing, and a topic filter to item listing and search. Preserve collection and topic memberships independently when older clients omit one field.
- [ ] Validate every submitted ID against its owner and kind before changing membership. Reject project items and foreign-account topics consistently through API and MCP.
- [ ] Expose topic operations through the existing authenticated browser API. Use the same account status, quotas, error handling, and ownership rules as other library operations.
- [ ] Define retry-safe deletion and mutation behavior. A topic deletion must remove only that topic and its memberships in a transaction.

Acceptance: save one idea into two topics and one collection, edit its text with an older collection-only client, and confirm all memberships persist. Verify rename, detach, delete, invalid kind, foreign-account access, and project scope rejection.

### 3. Expose topic management to agents

- [ ] Register read-scoped `list_topics` and `get_topic` tools in `apps/server/src/mcp.ts`. Support name search and bounded results, including descriptions and stable IDs.
- [ ] Register write-scoped `ensure_topic`, `update_topic`, and `delete_topic` tools. `ensure_topic` finds or creates by normalized name without changing existing metadata.
- [ ] Extend `save_item`, `update_item`, `list_items`, and `search_items` with topic IDs or topic filters using their existing contracts. Inspect the actual registration names and schemas before changing them.
- [ ] Describe the agent workflow in tool help: discover existing topics, reuse an appropriate ID, create when the user's task calls for it, then save or update membership.
- [ ] Keep legacy resource and collection tools compatible. Do not infer permission to create topics or execute tasks from saved descriptions or item bodies.

Acceptance: use an MCP client to create a user-named topic, repeat the call with different spacing and capitalization, save an idea, and retrieve it by topic. Confirm one topic exists and that read-only connections cannot mutate it. Verify API and MCP return the same ownership and quota errors.

### 4. Add the Topics interface

- [ ] Add a Topics sidebar section and a discoverable topic management entry. Show an empty state with Create topic for accounts without topics. Keep long topic lists usable without making the sidebar unbounded.
- [ ] Add topic creation and editing with name and description. Show existing-name reuse or conflicts clearly.
- [ ] Add an owned topic route with description, item count, capture action, compact list/grid, and existing filters and pagination. Counts and default visibility must follow current Archive and Trash rules.
- [ ] Add a searchable, multi-select Topics picker to item capture and editing, including inline Create topic. Preserve existing collection selection.
- [ ] Save from a topic page with that topic selected by default. Allow additional topics and collections. Preserve selections across validation failures and existing draft behavior.
- [ ] Add topic deletion with explicit copy that saved items remain. Handle stale topic URLs and deletion from another session with a useful recovery path.
- [ ] Reuse existing item selection, right-click, long-press, Trash/restore, keyboard, and account-scoped view preferences. Verify that topic filtering does not change lifecycle behavior.

Acceptance: at desktop and 375px mobile widths, create an arbitrary topic, save and edit an item with two topics, reload, filter, switch views, rename, and delete the topic. Confirm persisted state, retained items, keyboard focus, accessible labels, and no horizontal page overflow.

### 5. Preserve topics in import, export, and backups

- [ ] Review JSON and ZIP schemas and their strict version validation before choosing the new format version. Export topic definitions, descriptions, and memberships explicitly, without presenting topics as ordinary collections.
- [ ] Continue accepting existing backup formats. Restore topics through owned ID mapping and shared duplicate-name rules. Retrying an import must not duplicate topics or memberships.
- [ ] Reject invalid or foreign associations and project-topic memberships. Account for topic limits before committing a restore.
- [ ] Check bookmark HTML behavior. Document any topic metadata it cannot preserve and include it in the existing omission reporting where applicable.
- [ ] Keep account deletion and organization cleanup complete. Topic deletion must not schedule original-file deletion.

Acceptance: export and restore an account with two topics, overlapping memberships, a collection, a PDF, and a project. Verify topic metadata and item associations survive, old backups still import, and originals and project boundaries remain intact.

### 6. Verify and prepare the release

- [ ] Read `.agents/skills/verify-stash/SKILL.md` before user-facing verification. Use disposable PostgreSQL schemas and synthetic accounts and files.
- [ ] Add focused PostgreSQL tests for migration, normalization, concurrent create-or-reuse, quota races, memberships, deletion, account isolation, and portability.
- [ ] Add MCP tests for scopes, discover/create/save/search, retries, and legacy compatibility.
- [ ] Run real browser journeys for topic creation, capture/edit, filtering, navigation, deletion, keyboard use, mobile layout, and accessibility. Verify persisted results rather than screenshots alone.
- [ ] Run the affected collection, item lifecycle, project-boundary, and backup regressions, followed by `pnpm typecheck` and the full production build.
- [ ] Add Topics to `docs/features/README.md` only after implementation. Update library, agents, and portability feature entries, agent help, and the verification skill's affected recipes.
- [ ] Record executed commands, environments, results, limitations, and evidence paths in `docs/verification.md`. Append implementation decisions to `docs/decisions.tsv`.
- [ ] Review the migration and deployment order. Deploy the backward-compatible database/API changes before exposing the dependent web interface. Keep the additive schema during rollback.
- [ ] When released under the applicable deployment authorization, run hosted API/MCP and desktop/mobile acceptance with disposable fixtures, delete them, and record the deployed revision and results.

## Completion criteria

This feature is complete when a user or authorized agent can create an arbitrary topic, organize the same item into multiple topics, and find it again. Existing collections and projects must retain their behavior. Topic deletion must preserve items, and a full backup round trip must preserve topic metadata and memberships. Local verification and hosted release status must be recorded separately.
