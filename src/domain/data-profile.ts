import type { DataHubAssetSummary, DataHubEvidence } from './datahub'
import type { AgentProposal, DataProfileSnapshot, PipelineNode, PipelineNodeData } from './pipeline'

const maximumProfiledFields = 32
const maximumAnomalies = 8
const profileKeys = new Set([
  'sourceUrn', 'capturedAt', 'expiresAt', 'stale', 'platform', 'environment', 'quality',
  'fieldCount', 'profiledFields', 'sensitiveFieldCount', 'upstreamCount', 'downstreamCount',
  'anomalies', 'aggregateAudit', 'tokenEstimate', 'storage',
])
const profileFieldKeys = new Set(['name', 'type', 'tags', 'nullRate', 'distinctCount'])
const storageProofKeys = new Set(['kind', 'version', 'rawRowsStored', 'hostVerified'])
const aggregateAuditKeys = new Set([
  'kind', 'version', 'status', 'capturedAt', 'previousCapturedAt', 'rowCount',
  'previousRowCount', 'profiledFieldCount', 'riskSignals', 'rawRowsRead', 'hostVerified',
])
const riskSignalKeys = new Set(['id', 'kind', 'severity', 'field', 'summary', 'current', 'previous'])
const riskKinds = new Set(['empty_dataset', 'volume_drop', 'volume_spike', 'null_spike', 'fully_null', 'duplicate_drift', 'distribution_shift'])
const riskSeverities = new Set(['critical', 'high', 'medium', 'low'])

function boundedText(value: string, limit = 160) {
  return value.trim().slice(0, limit)
}

function estimateTokens(value: unknown) {
  return Math.max(1, Math.ceil(JSON.stringify(value).length / 4))
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key))
}

function validOptionalCount(value: unknown) {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 0)
}

export function isHostVerifiedAggregateDataProfile(value: unknown): value is DataProfileSnapshot {
  const profile = record(value)
  const audit = record(profile?.aggregateAudit)
  const storage = record(profile?.storage)
  if (!profile || !audit || !storage || !hasOnlyKeys(profile, profileKeys) || !hasOnlyKeys(audit, aggregateAuditKeys) || !hasOnlyKeys(storage, storageProofKeys)) return false
  if (storage.kind !== 'bounded-metadata' || storage.version !== 1 || storage.rawRowsStored !== false || storage.hostVerified !== true) return false
  if (audit.kind !== 'bounded-aggregate-profile' || audit.version !== 1 || audit.rawRowsRead !== false || audit.hostVerified !== true) return false
  if (!['complete', 'coverage_gap', 'unavailable'].includes(String(audit.status)) || typeof audit.capturedAt !== 'string') return false
  if (audit.previousCapturedAt !== undefined && typeof audit.previousCapturedAt !== 'string') return false
  if (!validOptionalCount(audit.rowCount) || !validOptionalCount(audit.previousRowCount) || !validOptionalCount(audit.profiledFieldCount)) return false
  if (!Array.isArray(audit.riskSignals) || audit.riskSignals.length > 12) return false
  if (!audit.riskSignals.every((value) => {
    const signal = record(value)
    if (!signal || !hasOnlyKeys(signal, riskSignalKeys)) return false
    if (typeof signal.id !== 'string' || typeof signal.summary !== 'string') return false
    if (!riskKinds.has(String(signal.kind)) || !riskSeverities.has(String(signal.severity))) return false
    if (signal.field !== undefined && typeof signal.field !== 'string') return false
    return [signal.current, signal.previous].every((metric) => metric === undefined || (typeof metric === 'number' && Number.isFinite(metric)))
  })) return false
  return audit.status === 'complete'
}

export function isHostVerifiedMetadataOnlyProfile(value: unknown): value is DataProfileSnapshot {
  const profile = record(value)
  const storage = record(profile?.storage)
  if (!profile || !storage || !hasOnlyKeys(profile, profileKeys) || !hasOnlyKeys(storage, storageProofKeys)) return false
  if (storage.kind !== 'bounded-metadata' || storage.version !== 1 || storage.rawRowsStored !== false || storage.hostVerified !== true) return false
  if (typeof profile.sourceUrn !== 'string' || typeof profile.capturedAt !== 'string' || typeof profile.expiresAt !== 'string') return false
  if (typeof profile.stale !== 'boolean' || typeof profile.platform !== 'string' || typeof profile.environment !== 'string') return false
  if (!['healthy', 'failing', 'unavailable'].includes(String(profile.quality))) return false
  if (![profile.fieldCount, profile.sensitiveFieldCount, profile.upstreamCount, profile.downstreamCount, profile.tokenEstimate].every((count) => Number.isInteger(count) && Number(count) >= 0)) return false
  if (!Array.isArray(profile.profiledFields) || profile.profiledFields.length > maximumProfiledFields) return false
  if (!profile.profiledFields.every((field) => {
    const entry = record(field)
    if (!entry || !hasOnlyKeys(entry, profileFieldKeys)) return false
    if (typeof entry.name !== 'string' || !['string', 'number', 'boolean', 'timestamp'].includes(String(entry.type))) return false
    if (entry.tags !== undefined && (!Array.isArray(entry.tags) || entry.tags.length > 8 || !entry.tags.every((tag) => typeof tag === 'string'))) return false
    if (entry.nullRate !== undefined && (typeof entry.nullRate !== 'number' || entry.nullRate < 0 || entry.nullRate > 1)) return false
    return entry.distinctCount === undefined || (Number.isInteger(entry.distinctCount) && Number(entry.distinctCount) >= 0)
  })) return false
  if (!Array.isArray(profile.anomalies) || profile.anomalies.length > maximumAnomalies || !profile.anomalies.every((anomaly) => typeof anomaly === 'string')) return false
  const audit = record(profile.aggregateAudit)
  return Boolean(audit && audit.rawRowsRead === false)
}

export function createDataProfileSnapshot(asset: DataHubAssetSummary): DataProfileSnapshot {
  const fieldProfiles = new Map(asset.dataProfile?.fields.map((field) => [field.name, field]) ?? [])
  const profiledFields = asset.fields.slice(0, maximumProfiledFields).map((field) => ({
    name: boundedText(field.name, 120),
    type: field.type,
    tags: field.tags?.map((tag) => boundedText(tag, 80)).filter(Boolean).slice(0, 8),
    nullRate: fieldProfiles.get(field.name)?.nullRate,
    distinctCount: fieldProfiles.get(field.name)?.distinctCount,
  }))
  const sensitiveFieldCount = asset.fields.filter((field) => field.tags?.some((tag) => /pii|sensitive|personal|gdpr/i.test(tag))).length
  const anomalies = [
    ...(!asset.fields.length ? ['Schema metadata is unavailable.'] : []),
    ...(!asset.owners.length ? ['No accountable owner is recorded.'] : []),
    ...(asset.qualityStatus === 'failing' ? ['DataHub quality checks are failing.'] : []),
    ...(asset.qualityStatus === 'unavailable' ? ['Quality metadata is unavailable.'] : []),
    ...(asset.dataProfile?.status === 'unavailable' ? ['Statistical profile metadata is unavailable; value-level health was not asserted.'] : []),
    ...(asset.dataProfile?.status === 'error' ? ['Statistical profile metadata could not be read; value-level health was not asserted.'] : []),
    ...(asset.dataProfile?.risks.map((risk) => `${risk.severity.toUpperCase()} ${risk.summary}`) ?? []),
    ...(asset.freshness.stale ? ['The metadata snapshot is stale.'] : []),
    ...(sensitiveFieldCount ? [`${sensitiveFieldCount} sensitive field${sensitiveFieldCount === 1 ? '' : 's'} require governed handling.`] : []),
    ...(asset.fields.length > maximumProfiledFields ? [`${asset.fields.length - maximumProfiledFields} additional fields were omitted from compact agent memory.`] : []),
  ].slice(0, maximumAnomalies)
  const aggregateStatus: DataProfileSnapshot['aggregateAudit']['status'] = asset.dataProfile?.status === 'available'
    ? 'complete'
    : asset.dataProfile?.status === 'error'
      ? 'unavailable'
      : 'coverage_gap'
  const aggregateAudit = {
    kind: 'bounded-aggregate-profile' as const,
    version: 1 as const,
    status: aggregateStatus,
    capturedAt: asset.dataProfile?.capturedAt ?? asset.freshness.capturedAt,
    previousCapturedAt: asset.dataProfile?.previousCapturedAt,
    rowCount: asset.dataProfile?.rowCount,
    previousRowCount: asset.dataProfile?.previousRowCount,
    profiledFieldCount: asset.dataProfile?.fields.length ?? 0,
    riskSignals: (asset.dataProfile?.risks ?? []).slice(0, 12).map((risk) => ({
      id: boundedText(risk.id, 180),
      kind: risk.kind,
      severity: risk.severity,
      field: risk.field ? boundedText(risk.field, 120) : undefined,
      summary: boundedText(risk.summary, 320),
      current: risk.current,
      previous: risk.previous,
    })),
    rawRowsRead: false as const,
    hostVerified: true,
  }
  const profileWithoutEstimate = {
    sourceUrn: boundedText(asset.urn, 2_000),
    capturedAt: asset.freshness.capturedAt,
    expiresAt: asset.freshness.expiresAt,
    stale: asset.freshness.stale,
    platform: boundedText(asset.platform),
    environment: boundedText(asset.environment, 80),
    quality: asset.qualityStatus,
    fieldCount: asset.fields.length,
    profiledFields,
    sensitiveFieldCount,
    upstreamCount: asset.upstream.length,
    downstreamCount: asset.downstream.length,
    anomalies,
    aggregateAudit,
    storage: { kind: 'bounded-metadata' as const, version: 1 as const, rawRowsStored: false as const, hostVerified: true },
  }
  return { ...profileWithoutEstimate, tokenEstimate: estimateTokens(profileWithoutEstimate) }
}

export function isDataProfileFresh(profile: DataProfileSnapshot, now = Date.now()) {
  const expiry = Date.parse(profile.expiresAt)
  return !profile.stale && Number.isFinite(expiry) && expiry > now
}

export function canReuseDataProfile(profile: DataProfileSnapshot, forcedMonitorAudit: boolean, now = Date.now()) {
  return !forcedMonitorAudit && isDataProfileFresh(profile, now)
}

export function summarizeDataProfile(profile: DataProfileSnapshot) {
  const storage = isHostVerifiedMetadataOnlyProfile(profile) ? 'metadata-only' : 'unverified storage'
  const dataAudit = profile.aggregateAudit.status === 'complete'
    ? `${profile.aggregateAudit.profiledFieldCount} aggregate fields · ${profile.aggregateAudit.riskSignals.length} value risks`
    : `aggregate ${profile.aggregateAudit.status.replace('_', ' ')}`
  return `${profile.fieldCount} fields · ${profile.sensitiveFieldCount} sensitive · ${profile.quality} · ${profile.stale ? 'stale' : 'fresh'} · ${dataAudit} · ${profile.upstreamCount} upstream · ${profile.downstreamCount} downstream · ${storage} · ~${profile.tokenEstimate} tokens`
}

export function dataProfileEvidence(profile: DataProfileSnapshot): { summaries: string[]; evidence: DataHubEvidence[] } {
  const summary = summarizeDataProfile(profile)
  return {
    summaries: [
      `Reused versioned Data Profile for ${profile.sourceUrn}: ${summary}.`,
      `Profiled schema: ${profile.profiledFields.map((field) => `${field.name}:${field.type}${field.tags?.length ? `[${field.tags.join(',')}]` : ''}`).join(', ') || 'unavailable'}`,
      `Profile anomalies: ${profile.anomalies.join(' ') || 'none'}`,
      `Aggregate dataset audit: ${profile.aggregateAudit.status}; rows=${profile.aggregateAudit.rowCount ?? 'unavailable'}; profiled_fields=${profile.aggregateAudit.profiledFieldCount}; value_risks=${profile.aggregateAudit.riskSignals.length}; raw_rows_read=false.`,
    ],
    evidence: [{ tool: 'data_profile_memory', urn: profile.sourceUrn, capturedAt: profile.capturedAt, expiresAt: profile.expiresAt, status: 'ok', summary, cached: true, stale: profile.stale }],
  }
}

function profilePatch(asset: DataHubAssetSummary): Partial<PipelineNodeData> {
  const profile = createDataProfileSnapshot(asset)
  return {
    label: `${asset.name} profile`,
    description: 'Bounded, versioned dataset evidence: schema plus aggregate row, null, uniqueness and distribution signals. No raw rows are read or stored.',
    owner: 'SAM LAB Agent',
    status: profile.stale || profile.quality === 'failing' || Boolean(asset.dataProfile?.risks.length) ? 'warning' : 'healthy',
    schema: [],
    rule: summarizeDataProfile(profile),
    profile,
    pinned: true,
    agentAdded: true,
  }
}

function profileId(urn: string) {
  let hash = 2166136261
  for (const character of urn) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return `profile-${(hash >>> 0).toString(36)}`
}

export function addDataProfileToProposal(proposal: AgentProposal, currentNodes: PipelineNode[], asset: DataHubAssetSummary, sourceNode?: PipelineNode) {
  const patch = profilePatch(asset)
  const existing = currentNodes.find((node) => node.data.kind === 'profile' && node.data.profile?.sourceUrn === asset.urn)
  if (existing) {
    const redundant = proposal.addedNodes.find((node) => node.data.kind === 'profile' && (!node.data.profile || node.data.profile.sourceUrn === asset.urn))
    if (redundant) {
      proposal.addedNodes = proposal.addedNodes.filter((node) => node.id !== redundant.id)
      proposal.addedEdges = proposal.addedEdges.filter((edge) => edge.source !== redundant.id && edge.target !== redundant.id)
    }
    const update = proposal.updatedNodes.find((candidate) => candidate.nodeId === existing.id)
    if (update) update.patch = { ...update.patch, ...patch, kind: 'profile' }
    else proposal.updatedNodes.push({ nodeId: existing.id, patch: { ...patch, kind: 'profile' }, reason: 'Refresh compact profile memory after a trusted DataHub read.' })
    return existing.id
  }

  const proposed = proposal.addedNodes.find((node) => node.data.kind === 'profile' && (!node.data.profile || node.data.profile.sourceUrn === asset.urn))
  if (proposed) {
    proposed.data = { ...proposed.data, ...patch, kind: 'profile' }
    return proposed.id
  }

  const anchor = sourceNode ?? proposal.addedNodes.find((node) => node.data.kind === 'source')
  const baseId = profileId(asset.urn)
  const usedIds = new Set([...currentNodes, ...proposal.addedNodes].map((node) => node.id))
  let id = baseId
  let suffix = 2
  while (usedIds.has(id)) id = `${baseId}-${suffix++}`
  proposal.addedNodes.push({
    id,
    type: 'pipeline',
    position: { x: (anchor?.position.x ?? 120) + 285, y: Math.max(40, (anchor?.position.y ?? 240) - 185) },
    data: { kind: 'profile', ...patch } as PipelineNodeData,
  })
  return id
}
