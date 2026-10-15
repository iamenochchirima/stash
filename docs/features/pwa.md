# Installable apps

Stash and Stash Admin have separate web app manifests, standalone windows and icons. The admin icon carries an ADMIN badge. Each origin installs independently and opens its existing signed-in experience. Authentication, MFA and account permissions continue to use the server.

Use the quiet **Install Stash** or **Install Stash Admin** action at the bottom of the page. Where the browser supplies an installation prompt, the action opens it. Otherwise it opens instructions for the browser menu, Safari Share menu or Safari Add to Dock. The action disappears in standalone mode or after the browser reports installation. No automatic install banner or notification permission request is used.

An internet connection is required. The service worker stores only the public reconnect page and four install icons. It never stores account pages, API responses, attachments, notes, summaries, app bundles or authentication links. Failed document navigation shows the reconnect screen. Try again reloads the same address. HTTP error responses keep their normal behavior. Private requests fail normally offline, with no offline write queue. A page already open can still display its in-memory content; the PWA does not change the browser's normal history or session behavior.

Workers update through network checks with cache bypass. On activation they remove older caches with their own app prefix and leave unrelated caches alone. Run `pnpm exec tsx scripts/generate-pwa-assets.ts` after changing the brand asset, reconnect page or worker source. Commit its generated public files alongside the generator. No new runtime dependencies are needed.

Verification: `pnpm test:browser tests/browser/pwa.spec.ts tests/browser/journeys.spec.ts tests/browser/admin.spec.ts`. The PWA recipe checks both manifests and real icon sizes, worker headers/control, old-cache cleanup, manual/native-prompt paths, keyboard focus, mobile reconnect layout, retry and private-cache exclusions. The native installation event is simulated. Physical device installation and OS window behavior require manual device acceptance. See docs/verification.md for actual results.
