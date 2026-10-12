# Public landing page

The redesign is local for review. Anonymous visitors see a public homepage at `/`. Sign up links lead to `/signup`; Sign in leads to `/signin`. Authenticated visitors still open their library at `/`. Verification/reset query links remain compatible.

The hero uses the optimized transparent illustration at `apps/web/public/stash-hero.webp`. Public pages use locally hosted DM Sans and Manrope with included OFL licenses. Copy describes saving during chat/research and retrieving in a later conversation without naming particular agent clients.

The second section has Save, Organize, and Retrieve controls. A saved reference moves through a vector illustration when the selection changes. Play walkthrough runs through the three stages once and Replay repeats it. Selecting a stage stops playback. Reduced motion removes transitions and skips the timed walkthrough. SVG descriptions, pressed button states, and a live caption describe the current stage.

`tests/browser/landing.spec.ts` checks desktop and mobile navigation, stage selection, reduced motion, page titles, eight-character password constraints, and overflow. `tests/browser/accessibility.spec.ts` checks the public page and account forms with axe; the existing complete account/library and recovery recipes use the new routes. Screenshots are in `docs/evidence/browser/landing-1440.png`, `landing-375.png`, `signup-1440.png`, and `signup-375.png`.
