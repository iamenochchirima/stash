# Agent connections

Agent connections displays the remote MCP endpoint and named keys. Verified users can create a read-only key or one with save/delete permission. With EMAIL_DISABLED=true, the hosted service also allows unverified users to create and use keys; re-enabling email restores verification checks for both creation and MCP authentication. New keys are shown once. The page records actual first use; setup retrieval is completed only by successfully getting a resource or returning a nonempty list/search.

Drive the key browser journey, `tests/mcp.test.ts`, and `scripts/clients-check.ts`. The SDK test exercises initialization, tools, scopes, errors, user boundaries, and revocation. The real-client script saves through Codex and retrieves through OpenCode. Inspect exact saved notes and collection IDs and an HTTP 401 after revocation. See `docs/agents.md` for the verified versions and setup.
