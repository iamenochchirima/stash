# Library v2 rollout

The baseline Railway artifact is 9610dfd7-41b5-443f-84a8-b96703969bb1. It requires URLs and is unsuitable after mixed items are enabled. Consumer/admin baseline PWA source is 0244c61 on d911c7e. Local additive migrations through 0022 are frozen. The representative migration fixture preserves 10,001 legacy links and 20,001 memberships, including original fields/timestamps, and repeats migration safely.

1. Keep LIBRARY_V2_ENABLED=false. Configure private B2 and free-only OpenRouter variables without replacing email/admin secrets or the existing /data/deletions volume. Keep both journals on that volume. Take a private pre-release PostgreSQL dump and check its archive index.
2. Deploy the mixed-item-aware backend. Its startup migration runs before journal replay and HTTP. Check readiness, schema version, feature gate, existing row counts and the old links-only contract before changing clients. Retain this new deployment ID as the minimum compatible rollback artifact.
3. Push the compatible consumer/admin source. Both Vercel projects deploy from main. Verify exact deployment revisions, public landing/sign-in, private cache behavior and API origin before enabling new types.
4. Enable LIBRARY_V2_ENABLED=true, keeping original storage private and summaries free-only. Verify disposable hosted mixed capture, PDF extraction/search/original byte equality, summaries, agent retrieval, lifecycle/backup and account deletion. Verify provider cleanup removes all object versions and records acknowledgement on persistent disk.
5. Record deployment IDs and evidence, remove all disposable customer data, then audit the checklist.

After activation, disable new item creation first if needed. Roll back application code only to the retained mixed-item-aware deployment and compatible consumer/admin build. Existing notes/ideas/PDFs remain readable. Never revert to the URL-required baseline or reverse migrations against live mixed data. An isolated database restore requires both journals, including events newer than the snapshot, before traffic. Preserve originals and cleanup intents throughout. Restored missing files must stay explicitly missing.

Automated production backups and external alerts remain known alpha limitations. This release does not buy plans, enable paid inference or claim those services are configured. Hosted rollout and acceptance remain pending until deployment records below are written.


Backend phase completed on 15 October 2026 at source a1c32f9. Railway deployment 252db9eb-32ab-4048-bfaf-b7f4d81e10c5 is SUCCESS with migrations through 0022 and LIBRARY_V2_ENABLED=false. This is the minimum mixed-item-aware rollback artifact. The one existing account, 13 links and 12 collection memberships are unchanged. Readiness returns 200. A private pg_dump was taken through Railway SSH and its archive index verified before deployment. The direct tunnel required SSL disabled for metadata queries; the initial default-SSL dump attempt was stopped and replaced by the validated SSH dump. Snapshot metadata and aggregate checks are in hosted-pre-release.json and hosted-backend-gated.json.
