const defaultBlankObjective = 'Start an evidence-backed autonomous incident workflow. Read list_card_kinds and its current activation plan before adding cards: every card must have a satisfied trigger and a reachable definition of done, and unused card kinds must stay out of the graph. Use the single adjustable host-owned Catalog Explorer sidecar to audit its configured governed dataset or catalog in bounded parallel batches, then select and branch from supported evidence without silently dropping catalog assets. Never connect Catalog Explorer to dataset lineage: it updates only its own checkpoint and Data Source branches start independently. Use a Worker only for independent deterministic batches, Query Check for registered GraphQL aggregate reads or governed writes, and operation=profile.read to obtain row counts, null rates, uniqueness and distribution evidence. Preserve bounded evidence in Data Profile, classify it with Data Analysis, add Impact Analysis only when lineage can prove affected assets, and add Risk Assessment only for material data, privacy, operational, ML or collection evidence. Use Split for real approved/quarantine outcomes, Agent Decision for a bounded correction-versus-escalation choice, Compatibility Patch for a reversible graph-only overlay, and Transform only for a declared derived contract. Use Parallel Agents and Incident Diagram only when multiple independent branches exist. Gate material work with Human Review and Validation, end useful branches with Output, then arm Live Monitor feedback only after the branch is stable. Never place arbitrary query text or raw rows in a card, and route governed writes through Human Review. Propose one coherent useful iteration with every card and connection required for that stage, commit the complete diff as a restorable version, then let the player reread the resulting graph and fresh evidence before continuing. When the connector is unavailable, create only an unbound Data Source plus Human Review and never invent metadata or dataset health.'

const dataIntent = /\b(agent|analyse|analyze|audit|catalog|cards?|cartes?|columns?|colonnes?|contracts?|data|datahub|datasets?|diagrams?|fields?|graphs?|graphes?|incidents?|lineage|metadata|models?|monitors?|ownership|pipelines?|profiles?|quality|risks?|risques?|schema|sources?|sql|tables?|transforms?|validation|workspaces?)\b/i
const graphAction = /\b(add|ajoute|build|compare|continue|corrige|create|cree|detect|discover|fix|improve|investigate|monitor|patch|repair|repare|review|route|run|surveille|trace|upgrade|verify)\b/i

export interface AgentObjectiveResolution {
  accepted: boolean
  objective: string
  defaulted: boolean
}

export function dataHubDiscoveryQuery(objective: string): string {
  const normalized = objective.trim().replace(/\s+/g, ' ')
  if (normalized === defaultBlankObjective) return '*'
  if (/\bSAM LAB Control\b/i.test(normalized) && /\b(?:objective|on_review|on_idle)=/i.test(normalized)) return '*'
  return normalized
}

export function resolveAgentObjective(rawObjective: string, options: { hasGraph: boolean; matchedSource: boolean }): AgentObjectiveResolution {
  const objective = rawObjective.trim().replace(/\s+/g, ' ')
  if (!objective) return { accepted: true, objective: defaultBlankObjective, defaulted: true }
  const accepted = dataIntent.test(objective)
    || options.matchedSource
    || (options.hasGraph && graphAction.test(objective))
  return { accepted, objective, defaulted: false }
}

export { defaultBlankObjective }
