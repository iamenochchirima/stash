# Appearance

The Profile page includes Light, Dark and System choices. The choice is saved in this browser and applied before the page hydrates. System follows the device's current color preference, including changes made while Stash is open. A saved choice updates other Stash tabs in the same browser.

The preference applies to the signed-in workspace, Topics and collections, Projects, saved-item reading pages, Help, and account screens such as sign-in and recovery. The public landing page keeps its existing light presentation. Clearing this browser's local storage removes the saved choice and returns to System. Preferences are not synced between browsers or stored in the account.

Run `TEST_DATABASE_URL=<owned disposable stash_test URL> pnpm test:browser tests/browser/appearance.spec.ts` to check saved preference across reloads, live OS changes, cross-tab updates, reading and account pages, mobile overflow, and accessibility in the affected themes. Screenshots and the final check are in [appearance evidence](../evidence/appearance/).
