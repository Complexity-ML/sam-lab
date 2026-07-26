# DataHub agent workflow

SAM LAB treats MCP tools as capabilities and DataHub Skills as the instructions for combining those capabilities safely.

## Audit workflow

1. **Search** — resolve the source card's DataHub URN and prefer an owned, documented or certified asset.
2. **Inspect** — read the entity, schema fields, tags, terms, owners and health signals.
3. **Trace lineage** — walk downstream far enough to include every output represented on the canvas.
4. **Compare** — compare DataHub lineage with the local graph and flag missing, reversed or unexpected paths.
5. **Validate governance** — propagate classifications such as PII through the proposed path and test every policy gate.
6. **Propose** — return a bounded graph diff containing known card types and existing node IDs.
7. **Review** — show all reads, warnings, additions, removals and intended writeback. Never auto-apply.
8. **Write back** — after approval, preserve the decision as a DataHub context document or governed metadata proposal.

## Required guardrails

- Read-only MCP tools are allowed during analysis.
- Mutation tools require explicit user approval and DataHub-side enablement.
- A proposed graph must be acyclic and every connection must reference existing cards.
- Data Source cards cannot have inputs; Output cards cannot have outputs.
- Every Split must retain at least two labeled branches.
- Sensitive field transformations must be visible as cards, not hidden in an agent explanation.
- If DataHub is unavailable, the app stays in Demo mode and does not claim a successful writeback.

## DataHub Skills mapping

| Stage | Skill | Purpose |
| --- | --- | --- |
| Connect | `datahub-setup` | Authenticate and verify the instance |
| Discover | `datahub-search` | Find trustworthy catalog assets |
| Impact | `datahub-lineage` | Trace upstream and downstream consumers |
| Guard | `datahub-quality` | Inspect health and assertions |
| Preserve | `datahub-enrich` | Apply approved catalog context |
