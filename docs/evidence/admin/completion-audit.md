# Admin completion audit

Checked against ADMIN_IMPLEMENTATION.md on 14 October 2026. The full hosted lifecycle and final account-history correction are deployed and verified. All implementation checklist gates are complete.

| Requirement | Current evidence | Result |
| --- | --- | --- |
| A1 scope, privacy, role and interface direction | Approved plan; apps/admin; inspected desktop, tablet, users/access/operator mobile screenshots | Passed |
| A2 separate client, models, identity, MFA, authorisation and audit | Migrations 0005/0006; shared safe DTOs; 50 final integration tests including 20 admin cases; consumer/key/OAuth exclusion and secure-cookie tests | Passed; permanent owner enrolled |
| A3 shared lifecycle, search/detail, suspension/support, deletion and races | account-lifecycle.ts; API/browser suspension and restore; independent sign-out/disconnect; mixed login/key/OAuth races for suspension and deletion; journal write/SQL failure and replay; full storage recovery drill | Passed locally |
| A4 metrics, status, metadata, pagination, activity, admin access and performance | Real fixture counts; query-only period/pagination browser checks; bounded API queries; owner-only management; 10,000 customers/50,000 resources and indexed query plans | Passed |
| A5 compact layout, failure/expired/denied/empty states, keyboard, responsive checks and regression | 13-test combined browser run followed by strengthened owner/operator/viewer focused run; native-dialog Escape/focus return; zero admin-users axe violations; typecheck/build reports | Passed; automated checks do not replace a human screen-reader audit |
| A6.1 domain, projects, origin and encryption key | deployment.json; domain ownership/HTTPS; private Railway configuration | Passed |
| A6.2 additive migration and old data | Production migration count 4 to 5, one customer and 13 resources preserved; subsequent hosted consumer fixture cleaned up | Passed |
| A6.3 initial owner enrolment | CLI invitation delivered; subsequent production activation query found one active owner and zero pending owner invitations | Passed; human enrolled their own credentials |
| A6.4 deployment and transport boundaries | Railway SUCCESS; Vercel READY; HTTPS/frame/referrer headers; origin tests and anonymous refusal; production-cookie attributes integration test | Passed; the same browser had an owner admin session and a separate customer sign-in page |
| A6.5 hosted privileged lifecycle | Required disposable inspect/suspend/API-MCP denial/restore/reconnect/revoke/delete journey | Passed; owner inspect/suspend/API-MCP denial/restore/reconnect/revoke/delete, five successful audit events and zero fixture records; browser shows all five anonymous-history events |
| A6.6 consumer and MCP regression | Hosted verification email, OAuth discovery/DCR/PKCE/consent, SDK save/retrieve, manual read scope, refresh/revocation and cleanup; unchanged MCP tool registration | Passed |
| A6.7 deployment records and recovery/limits | operations.md; deployment/boundary/provider evidence; bootstrap/recovery/maintenance commands and persistent-journal contract | Recorded; automatic backups and alerts remain unconfigured |

AT01–AT09 are covered by PostgreSQL-backed integration tests, source boundary review, capacity and recovery evidence. AT10 has real owner, operator and viewer browser journeys. AT11 has the existing full customer/OAuth suite and hosted consumer regression. AT12 has hosted owner/password-MFA enrolment, cookie isolation, fresh identity confirmation, the full disposable lifecycle and verified cleanup. Final deployment/read-view proof is in deployment.json, hosted-audit.json and hosted-audit-complete.png.

GitHub CI could not start due an account billing/spending-limit restriction. No remote CI success is claimed and no paid account changes were made. Local tests, typechecking, builds, browser and hosted consumer checks ran; ci-status.json records the provider restriction.

No live owner password, invitation token, MFA secret, recovery code or session cookie was read or captured. Production action tests must touch explicitly disposable customers only. Never activate the permanent owner's credentials on their behalf merely to satisfy this audit.
