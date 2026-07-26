# DataHub OSS end-to-end verification

This procedure exercises SAM LAB against a real DataHub OSS quickstart. It keeps DataHub MCP mutations disabled and never commits credentials.

## 1. Start DataHub and load the official showcase

Prerequisites: Docker Compose v2, Python 3.10+, the DataHub CLI, Node.js 20+, npm, and `uvx`.

```bash
datahub docker quickstart
datahub init
datahub datapack load showcase-ecommerce
```

`datahub init` is intentionally interactive. Use the local quickstart credentials printed by DataHub rather than putting a password in a repository or shell-history example. The showcase command is experimental in DataHub 1.6.0.

Open `http://localhost:9002` to confirm that the catalog is populated.

## 2. Verify the required MCP reads

```bash
npm install
npm run verify:datahub-oss
```

The verifier starts `uvx mcp-server-datahub@latest` over stdio with `TOOLS_IS_MUTATION_ENABLED=false`, searches for a real dataset, and requires successful responses from:

1. `get_entities`
2. `list_schema_fields`
3. `get_lineage`

It prints a bounded JSON trace and captures no raw rows or credentials. The reviewed sample run is stored in [`examples/datahub-oss/mcp-evidence.json`](../examples/datahub-oss/mcp-evidence.json).

## 3. Run the desktop workflow

```bash
DATAHUB_GMS_URL=http://localhost:8080 npm run electron:dev
```

In **Settings → Connections → DataHub**, choose **Local stdio**, use `http://localhost:8080`, leave the token empty for the unauthenticated local quickstart, then connect.

Bind the discovered `order_details` URN to a Data Source card, run the agent, inspect the complete graph diff, approve the Human Review revision, and run atomic validation. The deterministic acceptance test verifies that the direct PII edge is removed, the protected path is connected, validation has no blocking issue, execution waits before approval, and completes after approval.

## 4. Optional provider-backed proposal

Running the connected AI provider sends the sanitized showcase URN, field classifications, lineage counts, graph, and validation finding to that external provider. It never sends raw rows or credentials. Perform this step only after approving that disclosure:

```bash
npm run verify:datahub-agent -- --confirm-external-share
```

The flag is the explicit external-sharing acknowledgement; the npm script does not add it automatically. The verifier first repeats the three live MCP reads, then uses the connected ChatGPT account in a read-only, ephemeral planning thread. SAM LAB denies tool requests and validates the returned strict proposal contract. It writes a private `provider-proposal.pending.json` artifact and does not claim that the graph changed.

Inspect the exact pending card and edge actions. Only after accepting that diff, run:

```bash
npm run approve:datahub-agent -- --approve-reviewed-diff
```

The second explicit flag records the human decision, materializes the provider proposal through SAM LAB's production graph adapter, runs the real pipeline validation and atomic execution checks, and only then publishes `examples/datahub-oss/provider-reviewed-workflow.json`. A failed check preserves the pending proposal and leaves the active graph unchanged.

## 5. Stop without deleting local state

```bash
datahub docker quickstart --stop
```

Do not use `datahub docker nuke` unless intentionally deleting the complete quickstart state.
