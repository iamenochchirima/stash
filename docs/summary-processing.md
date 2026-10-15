# On-demand summaries

This feature is implemented locally for Library v2. Hosted deployment and acceptance remain separate release gates.

A user explicitly requests an article or PDF summary. Saving or opening an item does not start generation. Notes, profile details and credentials are excluded from the prompt. The source text itself is sent to OpenRouter and its model provider, so the action includes a disclosure and expandable privacy details. Scanned PDFs need OCR and cannot be summarised here.

## Provider and privacy

The configured model is `cohere/north-mini-code:free`, reused from Lina through private host configuration. Paid model IDs are rejected. Before dispatch the adapter checks live catalog prices, with a five-minute cache. Requests cap prompt, completion, request and image prices at zero, disable provider fallbacks and set `data_collection: deny`. Reasoning is disabled for this short task; total output is capped at 4,096 tokens. No tools, plugins or web search are enabled.

The routing filter is not a blanket zero-retention guarantee. Provider retention terms and OpenRouter account logging settings still apply. Stash does not change the shared Lina/OpenRouter account's settings. See [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging) and [reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

## Source bounds and references

Article fetches use the existing validated DNS/socket rules: public HTTP(S) only, permitted ports, no credentials/cookies, revalidation on every redirect, bounded HTML and a seven-second overall budget. Hidden/executable/navigation content is removed. Unsupported, unavailable or detected paywalled pages fail without generating from their title.

PDFs use owned, ready extraction pages. Input contains at most 12,000 characters and 40 short source passages, preserving page or section references. A source hash covers the complete available text; partial-input coverage is explicit. The provider receives only source IDs, labels and text. Output must satisfy the bounded schema and cite IDs that were actually supplied. Stash attaches original source excerpts itself. An optional provider-supplied quote must match the cited material before it can be retained. Referencing source passages does not prove every generated statement is correct; the real acceptance set separately checks the resulting claims.

Saved summaries retain the source snapshot/hash, source revision, model, prompt version and generation date. Item metadata and source revisions are separate. Editing notes, collections, tags or favourites does not make a source summary stale. Changed PDF extraction text does. Remote articles are not polled for changes. Regeneration fetches the current page and records a changed source hash before provider preflight; a failed regeneration therefore leaves the older result marked stale. The generation date identifies the saved snapshot.

## Jobs, quotas and failures

Quota is reserved transactionally before dispatch. Limits are five requests and 300,000 reserved tokens per account per UTC day, 100 requests globally per UTC day, 1,000 globally per UTC month and $0 spending. Each job reserves 60,000 tokens, then reconciles reported usage. Cancellation or failure before dispatch refunds the token reservation but still counts the attempted request. Unknown outcomes retain the reservation. Usage metadata is retained for 90 days, independently of account deletion, so global limits cannot be reset by deleting an account. It contains opaque IDs, token/cost totals and outcomes, never source text, names, emails or credentials.

One summary job runs globally at a time. Durable leases recover process interruption. A dispatched job with an expired lease becomes unknown and is never replayed automatically. Request aliases bind every repeated/concurrent request ID to its original job, including after completion. No automatic provider retry is performed for timeout, ambiguous outcome, rate limit or invalid output. A reported positive charge latches a budget violation and blocks queued and new work even if currency rounding would make the displayed amount zero.

Queued work stops on Trash, account suspension or connection revocation. In-flight calls are aborted where possible and their results are discarded after cancellation, deletion or access loss. A provider may already have processed the request; cancellation cannot undo that. Failed regeneration preserves the previous saved summary and all user-written content. Account deletion cascades snapshots, saved summaries, jobs and aliases immediately; only bounded operational usage metadata remains until retention expiry.

## Verification

`tests/summaries.test.ts` covers source safety, response validation, quotas, aliases, concurrency, ambiguous outcomes, leases, cancellations, deletion, revocation and metadata edits during generation. `tests/mcp.test.ts` uses independent SDK clients to check write/read permissions, deduplication and account isolation. `tests/admin.test.ts` checks aggregate-only reporting. `tests/browser/summaries.spec.ts` drives the real app at desktop/mobile widths with an explicit external-provider test double.

Run `node --env-file=.env.local --import tsx scripts/check-summaries.ts` only with private free-model credentials. It makes three bounded real-provider calls against synthetic PDF/injection fixtures and RFC 2119. It uses disposable PostgreSQL schemas and private temporary local originals. `--article-only` reruns just the article case while preserving timestamped evidence for the already-passed PDF/injection cases. Safe results are in `docs/evidence/library-v2/openrouter-acceptance.json`. This proves local application/provider behavior, not hosted acceptance or native agent-client acceptance.
