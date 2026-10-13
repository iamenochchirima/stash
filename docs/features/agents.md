# Agent connections

Agent connections displays the remote MCP endpoint and named keys. Verified users can create a read-only key or one with save/delete permission. The hosted service now has email enabled through Resend, so verification is required for both key creation and MCP authentication. An explicitly disabled email configuration can temporarily permit unverified users. New keys are shown once. The page records actual first use; setup retrieval is completed only by successfully getting a resource or returning a nonempty list/search.

Drive the key browser journey, `tests/mcp.test.ts`, and `scripts/clients-check.ts`. The SDK test exercises initialization, tools, scopes, errors, user boundaries, and revocation. The real-client script saves through Codex and retrieves through OpenCode. Inspect exact saved notes and collection IDs and an HTTP 401 after revocation. See `docs/agents.md` for the verified versions and setup.

The connection page uses a plain Agent connections heading, the MCP endpoint/copy action, key controls, and collapsed Setup instructions. The empty state is No agent keys. Technical compatibility instructions remain available inside the setup disclosure and help page.

OAuth uses the same MCP URL alongside bearer keys. The /oauth/consent browser page preserves connection intent through signup/sign-in, requires verification when enabled, defaults to read-only, and permits requested write access only with explicit selection. OAuth rows are labelled in the shared connection list and revocation removes access and refresh tokens. The protocol/security recipes are tests/oauth.test.ts and tests/browser/oauth.spec.ts.

The canonical hosted MCP endpoint is https://api.stash.kasitek.co.za/mcp. Both agent keys and OAuth use this address. Connections configured with the earlier Railway MCP URL must update their endpoint; OAuth clients must reconnect because issuer/resource URLs changed. Agent keys remain valid. The Vercel dashboard proxy still reaches the same backend through its Railway service hostname.

Multiple OAuth assistants coexist independently. The regression test in tests/oauth.test.ts connects two clients on one account, verifies both listed and usable after refreshing, then revokes one and verifies only that connection disappears. A client can call /oauth/revoke itself; a missing row can therefore reflect client-initiated disconnection rather than replacement by another assistant.
