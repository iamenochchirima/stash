# Stash future feature backlog

These features are saved for future releases, separately from the [first release implementation plan](IMPLEMENTATION.md). The user confirmed this feature set on 12 October 2026. Inclusion here records the ideas; it does not add them to the first release or authorize implementation.

Each feature needs its own scope, implementation checklist, and acceptance tests before work starts. Release order has not been decided.

## Features and verification needs

| Feature | Scope and required verification before its release |
| --- | --- |
| Browser extension or bookmarklet | Save the current page with minimal effort. Verify authenticated saving, expired sessions, duplicate handling, browser permissions, and target-browser compatibility. |
| Shared collections | Invitations, member roles, and ownership. Verify read/write boundaries, invitation expiry, membership revocation, concurrent edits, and privacy after removing access. |
| Public profiles and selected collections | Explicit publishing controls and private-by-default behavior. Verify unpublished resources stay private, unpublishing removes access, and private notes never appear accidentally. |
| Automatic summaries and suggested tags | Clear generation status, user edits, retry/cost limits, and source links. Verify failure handling, content attribution, prompt-injection resistance, and preservation of manual notes. |
| Semantic search | Search by meaning with ownership-aware indexing. Verify relevance on a labelled fixture set, deletion/reindex behavior, cost bounds, and strict isolation between users. |
| Article and PDF ingestion | Store and retrieve permitted source content with bounded processing. Verify file validation, size limits, extraction failures, storage ownership, and deletion. |
| Code snippets and architectural decisions | Structured saved material with useful agent retrieval. Define fields and verify editing, search, export, and ownership. |
| Saved conversation excerpts | Explicit user selection and attribution. Verify consent, redaction, account isolation, export, and deletion. |
| Rich cross-resource retrieval and Lina integration | References across saved resources and a verified Lina setup. Verify source grounding, access boundaries, client compatibility, and revocation. |
