# Appearance

Profile → Appearance offers three independent choices, all saved in this browser:

- **Theme:** Light, Dark or System. System follows the device and updates when the operating system changes while Stash is open.
- **Style:** curated palettes for the active mode. Light: Paper (default), Cool, Warm. Dark: Forest (default), Midnight, Graphite, Warm.
- **Accent colour:** Violet (default), Indigo, Teal, Clay, Plum or Slate, chosen from a labelled swatch row with a ring and check on the selected colour.

Accent drives links, text buttons, focus rings, active navigation, selection surfaces, tags and citation chips. Primary buttons keep the neutral ink treatment in both modes. Success, warning and danger keep their own colours so status and action stay distinct.

Defaults are System, Paper/Forest and Violet, which reproduce the previous look. A saved choice applies before the page hydrates, updates other Stash tabs in the same browser, and falls back to the defaults when a stored value is unknown. Theme, per-mode style and accent are stored under `stash-theme`, `stash-theme-light`, `stash-theme-dark` and `stash-accent`. Preferences are not synced between browsers or stored in the account.

The preference applies to the signed-in workspace, Topics and collections, Projects, saved-item reading pages, Help, and account screens such as sign-in and recovery. The public landing page and other marketing surfaces keep their existing light presentation.

Run `TEST_DATABASE_URL=<owned disposable stash_test URL> pnpm test:browser tests/browser/appearance.spec.ts` to check reload persistence, live OS changes, cross-tab updates, every style and accent, invalid stored values, reading and account pages, mobile overflow, and accessibility. Screenshots, the browser log and the deployment record are in [appearance evidence](../evidence/appearance/).
