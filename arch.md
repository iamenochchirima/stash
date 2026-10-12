# Stash architecture

## Goal

**Save once, access from any agent.**

Build a standalone private research library that lets users save and retrieve resources through the dashboard and compatible MCP clients. Codex and OpenCode are the verified first-release pair. Other clients require their own compatibility checks.

The current first-release checklist is [IMPLEMENTATION.md](IMPLEMENTATION.md), verification results are in [docs/verification.md](docs/verification.md), and future features are tracked separately in [FEATURE_BACKLOG.md](FEATURE_BACKLOG.md).

Example interactions:

> Save this GitHub repository to my AI Agents collection.

> Find the GitHub repositories I saved about agent memory.

## Architecture

```text
        AGENT CLIENTS
 ┌─────────────────────────┐
 │ ChatGPT                 │
 │ Claude                  │
 │ Codex                   │
 │ Lina                    │
 │ Other MCP Clients       │
 └────────────┬────────────┘
              │
         Remote MCP
              │
              ▼
 ┌─────────────────────────┐
 │      MCP SERVER         │
 │                         │
 │ save_resource           │
 │ search_resources        │
 │ get_resource            │
 │ list_resources          │
 │ delete_resource         │
 └────────────┬────────────┘
              │
              ▼
 ┌─────────────────────────┐
 │       BACKEND API       │
 │                         │
 │ Authentication          │
 │ Resource Management     │
 │ Metadata Extraction     │
 │ Collections / Tags      │
 └────────────┬────────────┘
              │
       ┌──────┴──────┐
       ▼             ▼
   PostgreSQL     Web UI
```

The MCP server and REST API use the **same core services**, avoiding duplicated business logic.

## Stack

| Component | Technology |
|---|---|
| Language | TypeScript |
| Backend | Fastify |
| MCP | Official TypeScript MCP SDK |
| Database | PostgreSQL |
| ORM | Drizzle |
| Frontend | Next.js + plain CSS |
| Authentication | Email/password sessions + scoped agent keys |
| Hosting | Railway planned; deployment deferred |
| Monorepo | pnpm workspaces |

## Repository Structure

```text
stash/
├── apps/
│   ├── web/                  # Next.js dashboard
│   └── server/               # Fastify API + remote MCP
│       └── src/
│           ├── api/
│           ├── mcp/
│           │   ├── server.ts
│           │   └── tools/
│           ├── services/
│           ├── middleware/
│           └── index.ts
│
├── packages/
│   ├── db/                   # Drizzle schema + migrations
│   ├── core/                 # Resource business logic
│   └── shared/               # Types + validation schemas
│
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

## Data Model

The PostgreSQL schema uses these tables:

| Table | Purpose |
|---|---|
| `users` | Private profiles, verified email, sanitized avatar, and persisted onboarding milestones |
| `sessions` | Hashed browser sessions with expiry |
| `account_tokens` | Single-use verification and password reset token digests |
| `api_keys` | Hashed scoped agent credentials and last use |
| `resources` | URLs, titles, descriptions, notes, metadata |
| `collections` | Group resources by topic |
| `resource_collections` | Many-to-many relationship between resources and collections |

Each resource also stores `source_agent`, `created_at`, `updated_at`, metadata status, and a generated search document. Composite foreign keys prevent membership across owners. Versioned migrations upgrade the original one-collection scaffold without losing membership.

Account deletion records a durable intent outside database snapshots before deleting live data. Restore/startup reapplies those intents.

Use PostgreSQL full-text search initially. Semantic search and embeddings can be added later.

## MCP Tools

| Tool | Purpose |
|---|---|
| `save_resource` | Save a URL with context, notes, and optional collection |
| `search_resources` | Search saved resources |
| `get_resource` | Retrieve one resource and its metadata |
| `list_resources` | Browse resources, optionally by collection |
| `delete_resource` | Remove a saved resource with write permission |
| `list_collections` | Resolve private collection names and IDs |

Expose a remote MCP endpoint using **Streamable HTTP**. The agent should resolve references such as “that Anthropic article we discussed” from its conversation context before calling `save_resource`.

## Implementation and verification

Use [IMPLEMENTATION.md](IMPLEMENTATION.md) as the completion checklist. Accounts, onboarding, ownership-aware library services, multiple collections, import/export, and remote MCP form the first release. API and MCP share the same services.

Development, tests, and production use PostgreSQL. Tests create disposable schemas. Browser checks use an isolated API and dashboard and capture screenshots. The real-client check saves through Codex and retrieves through OpenCode. Production build, restart, restore/deletion replay, accessibility, and capacity evidence are in [docs/verification.md](docs/verification.md).

Public hosting, business email, domains, backup schedules, and monitoring activation remain deployment tasks under the user's scope decision. Local SMTP capture tests verify email behavior without sending real mail.

## Integration Considerations

- Validate write operations using an MCP client that supports remote MCP writes.
- ChatGPT custom MCP capabilities depend on account plan and current platform support; verify write permissions before relying on ChatGPT for the MVP acceptance test.
- Use authenticated, scoped API keys and keep secrets out of the repository.

## Future features

See [FEATURE_BACKLOG.md](FEATURE_BACKLOG.md). These additions are separate from the first-release implementation.
