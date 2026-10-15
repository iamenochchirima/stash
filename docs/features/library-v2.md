# Library v2

Implementation follows [the release checklist](../../LIBRARY_V2_IMPLEMENTATION.md). The goal remains active. These are local changes; production remains on the previous release until coordinated deployment.

The verified foundation adds private /items/[id] pages, card-body/title navigation, separate Open source, direct-link sign-in return, full context, editing and copy-private-link. New items include URL-free notes/ideas, safe Markdown reading, favourites, archive, 30-day Trash and restoration. The mixed-item /api/items contract and MCP tools share account ownership, revision checks and lifecycle rules. Legacy /api/resources and resource MCP tools remain link-only. New-kind capture is separately gated; linked-item reading and creation remain available during rollout.

JSON v2 preserves complete text, collections, favourites and archive/trash state; v1/bookmark imports remain available. Original PDF backup support is pending. An hourly bounded maintenance worker removes expired trash and request identities. The existing admin lifecycle and global operations still need full release regression.

Focused integration tests: tests/items.test.ts, tests/items-migration.test.ts, tests/items-portability.test.ts and the mixed-item scenario in tests/mcp.test.ts. Browser recipes: tests/browser/item-detail.spec.ts and tests/browser/items.spec.ts. Current evidence is in docs/evidence/library-v2. The browser harness uses a higher global request ceiling for aggregate rapid test traffic; individual authentication/MFA limits remain in force and the production ceiling stays unchanged.

Pending: Backblaze private storage/credentials and real hosted acceptance, isolated PDF extraction, full PDF backup, OpenRouter summary processing and budget enforcement, complete admin metadata updates, final security/regression checks and coordinated deployment. Lina's configured cohere/north-mini-code:free model was found in OpenRouter's public model catalog with zero prompt/completion price; no paid inference or new storage was provisioned.
