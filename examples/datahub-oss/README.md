# DataHub OSS end-to-end evidence

This directory contains judge-readable, sanitized evidence from a real local DataHub OSS 1.6.0 quickstart loaded with the official `showcase-ecommerce` data pack.

- `mcp-evidence.json` records successful `get_entities`, `list_schema_fields`, and `get_lineage` reads over the official local stdio MCP server.
- `reviewed-correction.json` is the deterministic acceptance fixture used to prove graph materialization, explicit Human Review, and atomic replay. It is deliberately not described as provider output.
- `reviewed-pipeline.json` is the same approved correction as a versioned SAM LAB import artifact, including its sanitized DataHub evidence provenance.
- `validation-report.json` records the initial blocking atom, the reviewed candidate result, and the replay states before approval, after approval, and after rejection.
- A provider-backed `agent-proposal.json` is generated only after the operator explicitly approves sharing the sanitized showcase URN, field classifications, and lineage counts with the connected provider.

No raw rows, credentials, authorization headers, or mutation-tool results are stored here.

See [`docs/datahub-oss-e2e.md`](../../docs/datahub-oss-e2e.md) for the exact setup, verification, external-sharing gate, and teardown commands.
