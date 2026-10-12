# Stash first release verification

The first-release project is implemented and locally verified with PostgreSQL. Public deployment, real business email configuration, domains, hosted backup schedules, monitoring activation, and hosting costs were explicitly deferred by the user. They remain launch gates rather than completed hosted checks.

## Environment and scope

Verification ran on 12 October 2026 using Node.js 23.11.1, PostgreSQL 18.6, pnpm 10.30.1, Next.js 16.4.0, and Chromium through Playwright 1.64.0. The documented deployment target is Node.js 24 LTS. CI configuration targets Node 24 but has not run remotely in this session.

Tests use a dedicated `stash_test` database and disposable schemas. The normal development database is separate. Email checks used private file capture and a local SMTP server; no messages were sent to real users. Real agent checks used disposable credentials and the clients' existing model access.

The exact final source digest is recorded in `evidence/source-fingerprint.json`. Results refer to the working tree captured there; no remote repository or hosted release was created.

## Results and reproducible checks

| Check | Result and evidence |
| --- | --- |
| Lockfile installation | `pnpm install --frozen-lockfile` passed. [Install report](evidence/install.txt). |
| Type checks | `pnpm typecheck` passed across shared schemas, database, core, server, and dashboard. [Report](evidence/typecheck.txt). |
| Backend tests | 22 tests passed with no skips, using real PostgreSQL. Account verification/recovery, sessions, avatars, deletion, isolation, migrations, concurrency, library/search, MCP, metadata boundaries, and portability are covered. [Report](evidence/backend-tests.txt), [test sources](../tests/). |
| Browser paths | 6 tests passed: full account/library/import/export/key/deletion journey, recovery, mobile keyboard paths at 375 and 768 pixels, accessibility, and out-of-order search responses. Desktop checks run at 1440 pixels. [Report](evidence/browser-tests.txt), [screenshots](evidence/browser/). |
| Accessibility | Zero axe WCAG A/AA violations on signup, library, save dialog, and profile. Keyboard focus/trapping/return, Escape, and width overflow also have assertions. This is automated/browser evidence, not a claim of a full human screen-reader audit. [Report](evidence/accessibility.json). |
| Real agent pair | Codex CLI 0.162.1 saved a repository with exact notes and Inbox membership; OpenCode 1.18.35 retrieved it. Revocation returned 401. [Acceptance report](evidence/client-acceptance.json), [Codex output](evidence/codex-client.txt), [OpenCode output](evidence/opencode-client.txt). |
| Production output | Web and server builds pass. The built server starts using production configuration and shuts down cleanly. [Build report](evidence/build.txt), [runtime report](evidence/production-smoke.txt). |
| Persistence and recovery | Project-owned PostgreSQL was stopped/restarted. Sessions, profiles/onboarding, resources/memberships, and keys persisted. Readiness returned 503 during the outage and 200 after recovery. A real dump/restore reinstated a deleted account; journal replay removed it and dependent data. [Report](evidence/recovery.json), [drill](../scripts/recovery-check.ts). |
| Capacity | 10,000 resources, 100 collections, 10 concurrent clients; zero errors. Listing/search/duplicate saves passed the preselected local p95 <= 1,000 ms target, and resource quota rejection passed. [Measurements](evidence/capacity.json). These are local measurements, not hosted promises. |
| Dependency audit | Production dependency audit reports zero advisories after updating mail/image dependencies. [Report](evidence/dependency-audit.json). |
| Evidence secret scan | Saved reports and screenshots contain synthetic test data, not full keys, session cookies, or recovery tokens. [Scan](evidence/secret-scan.json). Private outboxes, snapshots, and journals remain under ignored `.data/`. |
| Harness cleanup | Explicit Playwright global teardown drops the run's schema, removes the schema registry, and leaves evidence intact. API/dashboard processes stop and their ports become free. [Report](evidence/browser-cleanup.json). |

## Requirement coverage

| Requirements | Evidence |
| --- | --- |
| D01 to D09 | [Recorded decisions](decisions.md), user scope/client corrections, and [checkpoint trail](decisions.tsv). |
| F01 to F10 | Install/type/build reports, PostgreSQL migrations and tests, documented commands, and the CI workflow. CI definition is present; remote CI execution is deferred until repository publication. |
| A01 to A11 | Account integration/browser tests, scoped ownership tests, sanitized avatar tests, secure cookie tests, locked reauthentication, and restore/deletion replay. Production retention configuration remains a hosting gate. |
| O01 to O07 | Persisted onboarding fields, browser setup journey, actual MCP use/retrieval, private empty states, and client-support help. |
| L01 to L14 | Library/isolation/search/concurrency/metadata tests, browser journeys, accessibility report, and resource source/metadata display. |
| M01 to M12 | SDK protocol tests plus real Codex/OpenCode calls and revocation. M12 OAuth is explicitly inapplicable to this verified bearer-token pair; OAuth-only clients are not claimed. |
| P01 to P07 | HTML/JSON validation, preview-before-write, partial reports with original indexes, empty collections, complete export beyond a page, ID remapping, and round-trip tests. |
| E01 to E08 | Browser signup/library/profile, real cross-agent, read-only/revocation, two-user isolation, recovery, import/export, mobile/keyboard, and account deletion/recovery tests respectively. |
| T01 to T21 | Test matrix in IMPLEMENTATION.md maps to the reports above. T19 hosted checks and live business email delivery are deferred; local production/recovery preparation passed. |
| R01 to R10 | Setup/architecture/agent/help/operation documentation, local proof, fixed review findings, source/evidence audit, and the reviewable project. Hosted activation parts are launch gates per the user's scope correction. |

## Review findings and repairs

An independent agent reviewed the implementation and evidence. Findings led to these fixes:

- Revalidate password hashes under a user-row lock before issuing login sessions or deleting accounts, preventing concurrent reset races.
- Include DNS in the total metadata deadline and pin connections to validated public addresses.
- Preserve empty collections during imports and report original file indexes after invalid entries.
- Commit each imported resource with its metadata and timestamps atomically.
- Export from a repeatable-read database snapshot so concurrent writes cannot shift pages.
- Keep deletion intents outside restored database snapshots and replay them before traffic.

A fresh agent discovered the verification skill through `AGENTS.md`, followed it, inspected screenshots, and found that process-group shutdown could leave a disposable browser schema. Explicit global teardown fixed that defect and the fresh agent confirmed cleanup. The same review caught a screenshot captured before resource loading finished; the recipe now waits for both saved cards before taking the screenshot.

The primary agent performed an evidence audit of saved outputs, current files, and the decision trail. No inaccessible transcript or cross-model audit is claimed. Earlier manually entered decision-log timestamps were explicitly superseded by an automatically stamped correction row.

## Remaining deployment gates

No live sender/domain/host was chosen, no paid resource was provisioned, and no public deployment occurred. Before public launch, configure business SMTP, HTTPS origins, PostgreSQL, persistent independent journal storage, backup retention, restore access, monitoring alerts, and costs. Obtain deployment approval and rerun hosted acceptance. Multiple backend replicas require shared journal storage; separate per-instance journals are unsupported.

Hermes and Claude were not verified. Claude's account was unavailable; the user selected OpenCode instead. The verified pair is Codex/OpenCode. Future backlog features remain separate.

## Password length follow-up

At the user's request, signup and password recovery now require at least 8 characters. A focused PostgreSQL-backed test verifies that signup, login, and recovery accept 8 characters and signup/recovery reject 7. See [the focused report](evidence/password-length-tests.txt). The browser account journeys use 8-character signup and reset passwords. Type checks and the production build are rerun for this change; the original 22-test baseline above remains the first-release record.

## Hosted deployment, 12 October 2026

The user authorized Railway backends and Vercel dashboard deployment, then selected email disabled. PostgreSQL 18 and the API/MCP backend are in Railway project Stash; the dashboard is https://stash-tau-seven.vercel.app. Both use platform HTTPS domains. The backend has a separate persistent deletion-journal volume and a single replica. Runtime migrations run before server startup. `/ready` is configured as the deployment health check.

`pnpm test` passed 24 PostgreSQL-backed tests with no skips, including disabled-email signup and key issuance. `pnpm test:browser` passed all 6 browser tests with the default email-enabled local capture mode. `pnpm typecheck` passed. A focused production configuration test passed with EMAIL_DISABLED=true and no SMTP, and rejects missing SMTP when email is enabled. See [backend](evidence/deployment-backend-tests.txt), [browser](evidence/deployment-browser-tests.txt), [type checks](evidence/deployment-typecheck.txt), and [configuration](evidence/deployment-config-tests.txt).

A real Chromium browser exercised the public Vercel URL: eight-character signup, saving, reload persistence, sign out/in, and secure HttpOnly session cookies. Two independent MCP SDK clients exercised the public Railway endpoint: writer save, reader retrieval, read scope, and immediate revocation. Wrong-origin mutation returned 403 and disabled password recovery returned 503. The disposable account was deleted and its session returned 401. See [sanitized hosted results](evidence/hosted-deployment.json) and [hosted library screenshot](evidence/browser/hosted-library.png). This is SDK protocol proof; the earlier actual Codex/OpenCode acceptance remains local.

Railway rejected automatic volume backups with “Manual backups and backup schedules are only available for Pro workspaces.” No plan upgrade was performed. PITR is disabled. External alerts, hosted snapshot/restore, hosted actual-client acceptance, and business SMTP remain pending. Deployment success does not mark those checks as passed. Email re-enablement restores verification requirements for keys and MCP; users are not falsely marked verified while email is disabled.

The final deployed artifacts are Railway `4560b434-5bc1-40ad-88d0-c2afb3f86262` (SUCCESS) and Vercel `dpl_2KPwAw9S6C6SWJ7jh1eS1dQ6511Y` (READY). The Vercel CLI temporarily failed to confirm status; a separate inspect confirmed READY and the production alias. Hosted checks were rerun successfully against these final artifacts. [Resource summary](evidence/deployment-resources.json).

## Resend activation, 12 October 2026

The user authorized obtaining the existing Resend credential from KasiTek Growth and enabling Stash email. The source project's credential and configuration were read without changing that project. Resend confirmed `kasitek.co.za` is verified with sending enabled. The key was transferred privately through Railway's stdin variable setter to RESEND_API_KEY. MAIL_FROM is `Stash <noreply@kasitek.co.za>` and EMAIL_DISABLED=false. No credential was placed in Vercel or repository files.

Stash sends through Resend's HTTPS API with a 10-second timeout and generic provider failure messages. SMTP and local private capture remain supported. A focused PostgreSQL-backed test checks actual signup/recovery messages across the isolated Resend boundary and provider rejection redaction. Production config accepts Resend plus MAIL_FROM and rejects an incomplete sender setup. The 2 focused tests, type checks, production server/web build, and all 6 browser tests passed. See [focused tests](evidence/resend-focused-tests.txt), [type checks](evidence/resend-typecheck.txt), [build](evidence/resend-build.txt), and [browser](evidence/resend-browser-tests.txt).

Hosted Chromium exercised signup with a unique Resend test recipient, verification through the actual provider-generated link, agent key rejection before verification, successful MCP access after verification, password recovery through the actual provider-generated reset link, new-password sign-in, reset-link reuse rejection, key revocation after recovery, and account deletion. Email contents were retrieved privately from Resend only for the disposable recipient; tokens and credentials are excluded from evidence. Resend initially queued the messages; both verification and reset messages were subsequently confirmed delivered through the provider API. See [hosted results and latest provider events](evidence/resend-hosted.json). Resend test addresses simulate delivery; this proves the provider integration and application flow, not placement in every real recipient's inbox.

The new backend deployment is `47dd6480-08ce-47cc-8ef8-904687f3c585` (SUCCESS); the Vercel dashboard is `dpl_DQgY5Z6ieUKjBtjQ7JYHXmMxGHLu` (READY). The prior disabled-email evidence remains a historical record. Backups and external alerts retain their previously documented limitations. Existing users must verify their email before creating or using agent keys now that email is enabled.

## Custom domain, 12 October 2026

The user requested `stash.kasitek.co.za`. The domain was attached to Vercel project Stash and its single DNS-only CNAME was created through the existing Cloudflare account. No nameservers, business email records, or other application records were changed. Vercel reports configured-correctly and verified. HTTPS returned 200 with normal certificate validation; the previous Vercel hostname returned 308 to the custom domain, preserving the query string.

Railway WEB_ORIGIN is now https://stash.kasitek.co.za. The resulting backend deployment `efaf75d9-03f3-4937-8408-316e52e81618` completed SUCCESS. HTTP checks through the custom domain passed signup, Secure/HttpOnly cookies, verification with the real generated email token, resource save, sign out/in and persisted retrieval, foreign-origin rejection, recovery with the real generated reset token, and new-password sign-in. Both Resend test messages were reported delivered and their links pointed to the custom domain. The disposable account was deleted. The browser visibly loaded the signup page over HTTPS on the new hostname, and the user's Stash tab was navigated there. No source/runtime code changed; no full build/test suite was repeated for this infrastructure-only change.

Evidence: [hosted checks](evidence/custom-domain.json), [DNS record](evidence/custom-domain-dns.json), [updated deployment resources](evidence/deployment-resources.json). Existing host-only browser sessions do not transfer between hostnames; users may need to sign in again. The MCP endpoint retains its existing Railway address.

## Local landing page redesign, 12 October 2026

The user requested a professional, simple public landing page and a dedicated signup page, then explicitly required local review first. Their feedback replaced the mock library hero with a quieter illustration, requested graphics/animation for the second section, and clarified that particular agent clients must not appear in the hero copy. The user approved committing this version as a design baseline before further changes. It remains local; the live site is unchanged.

Anonymous visitors see the landing page at `/`; signup and sign-in are `/signup` and `/signin`. Successful authentication opens the existing library at `/`. Verification and recovery query links, sign-out, deletion, and existing library journeys remain functional. Public pages use a transparent optimized hero asset, locally hosted OFL fonts, and an interactive Save/Organize/Retrieve walkthrough. Reduced motion disables transitions and timed playback. A subsequent focused desktop/mobile run also verified that Play advances through the stages, finishes, and enables Replay; both tests passed. See [animation checks](evidence/landing-animation-tests.txt). See [design notes and image prompt](landing-design.md).

`pnpm test:browser` passed all 8 tests on the final local revision. The full account/library/deletion and recovery journeys passed; new desktop/mobile checks verify dedicated routes, titles, stage controls, reduced motion, eight-character password constraints, and overflow. Axe reports zero violations on the landing, signup, library, save dialog, and profile. The production build and type checks passed. Reports: [browser](evidence/landing-browser-tests.txt), [build](evidence/landing-build.txt), [types](evidence/landing-typecheck.txt), [accessibility](evidence/accessibility.json). Screenshots: [desktop landing](evidence/browser/landing-1440.png), [mobile landing](evidence/browser/landing-375.png), [desktop signup](evidence/browser/signup-1440.png), [mobile signup](evidence/browser/signup-375.png).

Initial checks exposed Next.js's one-development-server-per-output-directory restriction and an account-navigation remount that increased request traffic. The browser harness now uses `.next-verification`; production verification builds use `.next-build-verification`, leaving the review server's `.next` output independent. Authentication routes now mount only the form and navigate to the library after success, avoiding a transient dashboard on the signup route. An axe run started before streamed route metadata finished; the recipe now waits for the signup title and heading. The final full suite passes with production rate limits unchanged.

The local review server remains on http://127.0.0.1:3000, with the existing local PostgreSQL API at 4000. Browser verification used a disposable schema at ports 3100/4100 and cleaned it up. No Railway or Vercel deployment was performed for these changes.

## Illustrated agent-save demo, 12 October 2026

The user requested a more compelling, video-like demonstration of typing a request to an agent, confirming a detailed preview, and saving it. The local implementation now has a 13.2-second animated conversation with thumbnail artwork, typed composer text, an agent confirmation preview, a simulated pointer click, and the same card moving to the reading list. Mobile changes scenes rather than shrinking two panes into unreadable columns. The shorter hero subtext discussed with the user is also applied. See [design and asset prompt](demo-design.md).

The full 9-test browser suite passed after initial implementation, covering account/library/recovery journeys plus the new timed demo. Final visual refinement fixed saved-status opacity, aligned the simulated pointer with its confirmation button, retained the initial thumbnail, and removed a Next.js thumbnail sizing warning. The final focused set of 4 browser tests passed: accessibility, full typed playback/pause/replay, desktop navigation/chapter/confirmation controls, and mobile/reduced-motion behavior. The production build and type checks pass. Evidence: [full suite](evidence/demo-browser-tests.txt), [final focused checks](evidence/demo-focused-tests.txt), [build](evidence/demo-build.txt), [types](evidence/demo-typecheck.txt), [accessibility](evidence/accessibility.json), [confirmation frame](evidence/browser/demo-confirm-desktop.png), and [saved frame](evidence/browser/demo-saved-desktop.png).

The illustration starts once on entering view, pauses when offscreen or the tab is hidden, and supports manual control. It is labelled Example workflow and makes no live save requests. The image and 8-minute reading badge belong to the fictional demo resource, not newly implemented persisted library fields. Account sessions, ownership, and backend behavior are unchanged. The local server remains available at port 3000; nothing was deployed or committed in this revision.

## Demo chat and populated library revision, 12 October 2026

The user requested a smaller Stash pane with existing saved resources and a ChatGPT-style left interface. The local demo now uses a 64/36 desktop split. Two saved cards are visible before saving; they shift down as the detailed new preview contracts into a third card. The final count is 3. Mobile preserves the populated library when changing scenes. The left uses neutral chat bubbles, a familiar toolbar, and a rounded composer with plus and circular send controls.

The focused 4-test set passed: accessibility, timed demo playback/pause/confirmation/replay, desktop chapter/navigation checks, and mobile/reduced-motion checks. A composer placeholder contrast failure was fixed before the passing run. Existing demo tests now check that both previous cards remain and the resource count grows from 2 to 3. A final playback/layout run also passed after keeping the opening source thumbnail compact. The production build and type checks pass. Evidence: [playback/layout](evidence/demo-chat-layout-check.txt), [focused browser checks](evidence/demo-chat-revision-tests.txt), [build](evidence/demo-chat-revision-build.txt), [type checks](evidence/demo-chat-revision-types.txt), and [populated saved frame](evidence/browser/demo-saved-stage.png).

The ChatGPT styling is a fictional visual example at the user's request. It does not establish a native ChatGPT integration; agent authentication and backend behavior are unchanged. This revision is local and uncommitted, with no deployment.


## Automatic demo playback, 12 October 2026

The demo starts when it enters view and repeats after a 1.8-second hold on the saved result. Offscreen and hidden-tab playback pauses; returning resumes it unless the user paused it manually. Reduced motion keeps the static saved result.

All 5 focused browser tests passed, including automatic start without interaction, the count returning from 3 to 2 on the next cycle, offscreen pause/resume, and a manual pause surviving a scroll away and back. Accessibility and desktop/mobile landing checks also passed. Production build and type checks passed. Evidence: [browser checks](evidence/demo-autoplay-tests.txt), [build](evidence/demo-autoplay-build.txt), and [types](evidence/demo-autoplay-types.txt). The change remains local and uncommitted.


## Demo without player chrome, 12 October 2026

Removed the playback bar, elapsed time, restart button, chapter tabs, and caption beneath the demo at the user's request. Playback still starts and loops automatically. A small pause/resume button appears only on hover or keyboard focus. Reduced motion keeps a static saved result without that button.

All 5 focused browser checks passed, including absent player chrome, typed playback and confirmation, automatic looping, offscreen pause/resume, manual pause persistence, and desktop/mobile account navigation. Accessibility, production build, and type checks passed. Evidence: [browser](evidence/demo-clean-tests.txt), [build](evidence/demo-clean-build.txt), [types](evidence/demo-clean-types.txt), and [saved desktop view](evidence/browser/demo-saved-desktop.png). The local preview responds on port 3000. Nothing was committed or deployed.


## Phone library demo, 12 October 2026

The Stash pane now sits inside a rounded phone frame with a status bar, camera island, and home indicator. The new card animates into the phone above the two existing resources. Narrow layouts transition from chat to the phone scene.

All 5 focused browser tests passed, including card confirmation/count, continuous playback, desktop/mobile landing and account navigation, and accessibility. The production build and type checks passed. Reviewed the saved desktop phone screenshot and the 375px landing screenshot. Evidence: [browser](evidence/demo-phone-tests.txt), [build](evidence/demo-phone-build.txt), [types](evidence/demo-phone-types.txt), [desktop phone](evidence/browser/demo-saved-stage.png), and [mobile landing](evidence/browser/landing-375.png). Changes remain local and uncommitted.
