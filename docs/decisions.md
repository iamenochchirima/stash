# Stash first release decisions

The append-only checkpoint trail is [decisions.tsv](decisions.tsv). These choices resolve the implementation plan's design questions.

| Decision | Outcome |
| --- | --- |
| D01 Scaffold | Retain the monorepo, shared validation, Fastify/Next.js structure, logo, and private dashboard design. Replace incomplete authentication, schema initialization, single-collection storage, and portability behavior. |
| D02 Email | Use configurable SMTP with private local file capture. The user will choose a parent-business sender later; no live email service is provisioned. Delivery was tested through a local SMTP capture boundary and browser recovery links. |
| D03 Clients | The user replaced unavailable Claude with Hermes or OpenCode. Verify Codex CLI and OpenCode as the first-release pair; both passed actual save/retrieve. No Hermes or Claude compatibility claim. |
| D04 OAuth | Not needed for the verified bearer-token pair. OAuth-only clients remain unsupported. This conditional requirement is explicitly inapplicable for this release. |
| D05 Collections | Preserve the original many-to-many model. Composite resource/collection owner constraints enforce isolation. Deleting collections preserves resources. |
| D06 Avatars | Re-encode static PNG/JPEG/WebP uploads to 256-pixel PNGs and store with PostgreSQL profiles. Maximum 2 MiB input and 16 megapixels. No separate object storage is needed. |
| D07 Limits | Password minimum 8 characters, as requested after the first release. Sessions 30 days; verification links 24 hours; reset links 30 minutes. Per user: 10,000 resources, 100 collections, 20 keys. JSON import 10,000 items/128 MiB; bookmark HTML 1 MiB. Metadata: total deadline 5 seconds including DNS, 512 KiB, 3 redirects, pinned public addresses, HTTP/HTTPS only on ports 80/443. |
| D08 Hosting | The user explicitly deferred hosting details, domains, email setup, and budget. Build and verify locally, prepare Railway instructions, and retain public deployment approval as a later gate. Propose 7-day backups and a separately retained durable deletion journal for that deployment. |
| D09 Styling | Keep Next.js and plain CSS for the existing Stash design. Remove remote font fetching, improve contrast, and document the actual stack rather than introducing Tailwind merely to match an earlier table. |

Onboarding milestones are historical: completing them persists after deletion of the initial resource or revocation of its key. The checklist stays visible until every milestone is complete. Resource URLs retain fragments, query ordering, and meaningful trailing slashes; only the agreed tracking parameters are stripped. URLs are immutable during editing; saving a different URL creates a separate resource.

Imports commit each valid resource atomically, including metadata and timestamps, and report failures with original entry indexes. Collection creation may precede a later resource failure and is reported separately. Existing duplicates keep their stored details. Empty collections survive a round trip. Exports use a repeatable-read snapshot and include profile details for reference, without replacing the destination account profile on import.

Local capacity acceptance uses p95 of at most 1,000 ms and zero errors for listing, search, and duplicate saves at 10 concurrent clients with 10,000 resources. This engineering threshold was selected before the final measured rerun. Hosted latency targets are deferred with deployment.
