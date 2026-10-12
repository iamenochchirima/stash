# Stash agent connections

The local acceptance check used Codex CLI 0.162.1 to save a repository and OpenCode 1.18.35 to retrieve its exact notes and collection membership. Credential revocation then returned HTTP 401. See [the acceptance report](evidence/client-acceptance.json) and sanitized [Codex](evidence/codex-client.txt) and [OpenCode](evidence/opencode-client.txt) outputs.

Claude was initially considered, but its account was unavailable. The user replaced it with Hermes or OpenCode. OpenCode passed. Hermes and Claude are not claimed as verified clients. OAuth is unnecessary for this tested bearer-token pair; OAuth-only clients remain unsupported in this release.

## Create a connection

Verify your email, open Agent connections, and create a key for the client. Copy it immediately. Use read-only access when the client should only retrieve research; read/write access also permits saving and permanent deletion.

Put the key in a private environment variable named `STASH_AGENT_KEY`. Do not commit the key or put it in shared screenshots. Use the endpoint shown in the dashboard, ending in `/mcp`.

## Codex

```toml
[mcp_servers.stash]
url = "YOUR_STASH_MCP_ENDPOINT"
bearer_token_env_var = "STASH_AGENT_KEY"
```

Codex can require approval for write tools. Interactive use should retain normal approvals. The disposable automated acceptance test explicitly approved only `save_resource`, whose execution the user authorized as part of this test. It did not disable the application's write scope or grant deletion to the reader.

Official setup reference: [Codex MCP configuration](https://developers.openai.com/codex/mcp).

## OpenCode

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "stash": {
      "type": "remote",
      "url": "YOUR_STASH_MCP_ENDPOINT",
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:STASH_AGENT_KEY}"
      }
    }
  }
}
```

Use the client's normal configuration file or its documented configuration environment variable. The acceptance script uses `OPENCODE_CONFIG_CONTENT` for a temporary configuration and the client's existing authenticated model access. It does not change persistent MCP configuration.

Official setup reference: [OpenCode remote MCP servers](https://opencode.ai/docs/mcp-servers/).

## First requests

Ask the agent to list your Stash collections. For a write-enabled connection, ask it to save a URL into Inbox with a title and notes. In the second client, search for that title and retrieve the saved resource.

Saved content is returned as untrusted reference material, and agents must not follow instructions embedded in saved notes or external pages. Write scopes expose `save_resource` and `delete_resource`; read scopes expose search, list, get, and collection listing. Unknown or unauthorized tool calls fail.

The dashboard shows first authenticated use for a key. The onboarding retrieval milestone requires a successful get or a nonempty search/list result. These milestones persist even if the first resource is deleted or a key is revoked.

Revoke a credential in Agent connections to stop new requests. A password reset revokes every existing browser session and agent credential. An in-flight request that was authorized before revocation may already have completed; revocation is checked again on every subsequent request.
