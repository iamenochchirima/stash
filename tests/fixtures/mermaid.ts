export const architectureDiagram = `flowchart TB
  Console["Console and API clients"] --> API["Application API: identity, configuration, runs"]
  CRM["CRM backend"] --> API
  Support["Support backend"] --> API
  Channels["Website and messaging adapters"] --> API

  API -->|"Workflow runs"| Engine["Workflow engine"]
  Engine --> Workers["Workflow handlers"]
  Workers --> Models["Model providers"]
  Workers --> Tools["Authorized business tools"]
  Tools --> Products["CRM, Support and customer APIs"]
  Workers -->|"Only when required"| Sandbox["On-demand code or browser sandbox"]

  API -->|"Personal workspace"| Manager["Workspace manager"]
  Manager --> Workspace["Isolated Workspace runtime and workspace"]
  Workspace --> Models
  Workspace --> Tools

  API --> PG[("Postgres: platform records and history")]
  Workers --> PG
  Manager --> PG
  Engine --> Disk[("Workflow persistent volume")]
  Workers --> Objects[("Object storage: sources and artifacts")]
  Workspace --> Objects`;

export const diagramNote = `## Logical architecture

\`\`\`mermaid
${architectureDiagram}
\`\`\`

## Request flow

\`\`\`mermaid
sequenceDiagram
  accTitle: Request flow
  Client->>API: Save a note
  API-->>Client: Saved
\`\`\`

## Ordinary code

\`\`\`ts
const useful = true;
\`\`\``;
