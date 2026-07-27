const defaultBlankObjective = 'Start an evidence-backed Software Asset Management workflow. Search the connected catalog for software inventory, license, seat, subscription, entitlement, contract, utilization, cost or renewal evidence. Ignore unrelated business datasets and do not turn PII classifications into a SAM objective. Read list_card_kinds and its activation plan before adding cards. Select one supported software asset source, preserve compact aggregate evidence without raw rows, analyze assignment and utilization, calculate cost or compliance impact, classify reclamation, entitlement, renewal or evidence-reliability risk, and require Human Review before any external change. End with a clear SAM report containing the product, purchased, assigned and active seats when available, reclaim candidates, annual spend or savings, evidence gaps and recommended owner action. Propose one coherent bounded iteration and never invent license metrics.'

const samIntent = /\b(application|applications|app|apps|approval|approved|asset|assets|compliance|contract|contracts|cost|costs|entitlement|entitlements|inventory|licence|licences|license|licenses|renewal|renewals|sam|seat|seats|software|spend|subscription|subscriptions|usage|utilization|vendor|vendors)\b/i
const graphIntent = /\b(agent|cards?|cartes?|diagram|diagrams|graph|graphes|monitor|monitors|pipeline|pipelines|validation|workflow|workflows|workspace|workspaces)\b/i
const graphAction = /\b(add|ajoute|build|compare|continue|corrige|create|cree|detect|discover|fix|improve|investigate|monitor|patch|repair|repare|review|route|run|surveille|trace|upgrade|verify)\b/i

export interface AgentObjectiveResolution {
  accepted: boolean
  objective: string
  defaulted: boolean
}

export function dataHubDiscoveryQuery(objective: string): string {
  const normalized = objective.trim().replace(/\s+/g, ' ')
  if (normalized === defaultBlankObjective) return 'license'
  if (/\bSAM LAB Control\b/i.test(normalized) && /\b(?:objective|on_review|on_idle)=/i.test(normalized)) return 'license'
  return normalized
}

export function resolveAgentObjective(rawObjective: string, options: { hasGraph: boolean; matchedSource: boolean }): AgentObjectiveResolution {
  const objective = rawObjective.trim().replace(/\s+/g, ' ')
  if (!objective) return { accepted: true, objective: defaultBlankObjective, defaulted: true }
  const accepted = samIntent.test(objective)
    || options.matchedSource
    || (options.hasGraph && graphIntent.test(objective) && graphAction.test(objective))
  return { accepted, objective, defaulted: false }
}

export { defaultBlankObjective }
