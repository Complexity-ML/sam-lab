import type { PipelineNode } from './pipeline'

export type SourceSelectionMode = 'single' | 'explicit-multiple' | 'all-candidates' | 'none'

export interface SourceSelection {
  mode: SourceSelectionMode
  sources: PipelineNode[]
  matchedTerms: string[]
}

const ignoredTerms = new Set([
  'avec', 'dans', 'data', 'dataset', 'datasets', 'donnee', 'donnees', 'faire', 'from', 'graph', 'graphe',
  'pour', 'source', 'sources', 'the', 'this', 'traiter', 'work', 'workspace',
])

function normalize(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function objectiveTerms(objective: string) {
  return [...new Set(normalize(objective).split(/\s+/).filter((term) => term.length >= 3 && !ignoredTerms.has(term)))]
}

function sourceText(source: PipelineNode) {
  return normalize([
    source.data.label,
    source.data.assetRef ?? source.data.datahubUrn,
    source.data.sourceSystem,
    source.data.datahubPlatform,
    source.data.datahubEnvironment,
    source.data.datahubDomain,
    ...(source.data.datahubTags ?? []),
  ].filter(Boolean).join(' '))
}

export function asksForMultipleSources(objective: string) {
  return /\b(all|compare|comparison|cross[- ]source|multiple|toutes?|plusieurs)\b/i.test(normalize(objective))
    || /\b(entre|between)\b.+\b(and|et)\b/i.test(normalize(objective))
}

export function asksForSeparateWorkspace(objective: string) {
  const value = normalize(objective)
  return /\b(new|nouveau|nouvelle)\s+(graph|graphe|workspace|project|projet)\b/.test(value)
    || /\b(graph|graphe|workspace|project|projet)\s+(separate|separe|separee|distinct|independent|independant)\b/.test(value)
    || /\b(separate|separe|separee|distinct|independent|independant)\s+(graph|graphe|workspace|project|projet)\b/.test(value)
}

export function workspaceNameFromObjective(objective: string) {
  const cleaned = objective
    .replace(/\b(new|nouveau|nouvelle)\s+(graph|graphe|workspace|project|projet)\b/gi, '')
    .replace(/\b(graph|graphe|workspace|project|projet)\s+(separate|séparé|séparée|distinct|independent|indépendant)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72)
  return cleaned ? `Agent · ${cleaned}` : 'Agent · Separate investigation'
}

export function selectDataSources(nodes: PipelineNode[], objective: string, maximum = 4): SourceSelection {
  const sources = nodes.filter((node) => node.data.kind === 'source' && (node.data.assetRef || node.data.datahubUrn))
  if (sources.length === 0) return { mode: 'none', sources: [], matchedTerms: [] }
  if (sources.length === 1) return { mode: 'single', sources, matchedTerms: [] }

  const normalizedObjective = normalize(objective)
  const terms = objectiveTerms(objective)
  const scored = sources.map((source) => {
    const haystack = sourceText(source)
    const label = normalize(source.data.label)
    const urn = normalize(source.data.assetRef ?? source.data.datahubUrn ?? '')
    const matchedTerms = terms.filter((term) => haystack.includes(term))
    const score = matchedTerms.length
      + (label.length >= 3 && normalizedObjective.includes(label) ? 12 : 0)
      + (urn.length >= 8 && normalizedObjective.includes(urn) ? 16 : 0)
    return { source, score, matchedTerms }
  }).filter((candidate) => candidate.score > 0)

  const wantsMultiple = asksForMultipleSources(objective)
  if (scored.length > 0) {
    const selected = (wantsMultiple || scored.length > 1 ? scored : [scored.sort((left, right) => right.score - left.score)[0]])
      .sort((left, right) => right.score - left.score)
      .slice(0, maximum)
    return {
      mode: selected.length > 1 ? 'explicit-multiple' : 'single',
      sources: selected.map((candidate) => candidate.source),
      matchedTerms: [...new Set(selected.flatMap((candidate) => candidate.matchedTerms))],
    }
  }

  return {
    mode: 'all-candidates',
    sources: sources.slice(0, maximum),
    matchedTerms: [],
  }
}
