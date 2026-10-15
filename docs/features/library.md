# Library and collections

All resources opens the private library. Save a resource opens a dialog with Link, Title, Why it matters, Tags, collection checkboxes, and Reading status. One resource can belong to several collections. New collection creates a group; selecting a collection exposes Manage collection for rename/delete. Deleting a collection preserves its resources.

Search your library and the reading status selector filter the saved resources. Existing normalized URLs return the saved resource without overwriting notes. Blank titles use optional external metadata with a manual fallback. Onboarding milestones record real saves, organization, connections, and retrievals and survive later deletion/revocation.

Drive the library browser journey and `tests/library.test.ts`. Inspect visible cards and the persisted resource/membership records. Verify counts, filters, pagination, concurrent duplicates, meaningful URL distinctions, and rejection of all foreign-user IDs. Metadata tests prove private networks and stalled/oversized fetches cannot block manual saving.

The signed-in library uses plain headings and resource cards focused on title, domain, notes, tags, collections, and reading status. Technical metadata-fetch status is no longer shown on cards; stored metadata and source-agent fields remain unchanged. Getting started is a collapsed details panel with the same milestone actions. Repeated workspace/privacy labels and the promotional sidebar block were removed.


The library now has explicit page routes: `/library`, `/library/favourites`, `/library/archive`, `/library/trash` and `/library/collections/[id]`. Search/type/status/pagination remain query parameters, and item return links preserve them. Sidebar destinations are native Next.js links with browser Back/Forward and reload support. Old signed-in root URLs redirect to their canonical library route.

The frontend separates route files in `apps/web/app`, domain components in `apps/web/components`, browser helpers in `apps/web/lib`, and session hooks in `apps/web/hooks`. Server-only session lookup validates the cookie against the API with no-store requests. The workspace provider shares the verified account and navigation metadata; the shell, brand, dialog, error note and item card are reusable components. Connections and profile no longer live in a library view switch. Routing regression tests inspect authenticated HTML before hydration, not just the eventual screen. Rollout evidence is recorded in docs/verification.md.
