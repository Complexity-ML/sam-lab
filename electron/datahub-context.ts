export interface DataValueRiskSignal {
  id: string
  kind: 'empty_dataset' | 'volume_drop' | 'volume_spike' | 'null_spike' | 'fully_null' | 'duplicate_drift' | 'distribution_shift'
  severity: 'critical' | 'high' | 'medium' | 'low'
  field?: string
  summary: string
  current?: number
  previous?: number
}

export interface DataValueProfileSummary {
  status: 'available' | 'unavailable' | 'error'
  capturedAt?: string
  previousCapturedAt?: string
  rowCount?: number
  previousRowCount?: number
  fields: {
    name: string
    nullRate?: number
    previousNullRate?: number
    distinctCount?: number
    uniqueProportion?: number
    previousUniqueProportion?: number
    mean?: number
    previousMean?: number
    stdev?: number
    previousStdev?: number
  }[]
  risks: DataValueRiskSignal[]
}

export type LineageAssetKind = 'dataset' | 'feature' | 'model' | 'deployment' | 'pipeline' | 'unknown'

export interface DataHubAssetSummary {
  urn: string
  name: string
  platform: string
  environment: string
  description: string
  owners: string[]
  domain?: string
  tags: string[]
  fields: { name: string; type: 'string' | 'number' | 'boolean' | 'timestamp'; tags?: string[] }[]
  qualityStatus: 'healthy' | 'failing' | 'unavailable'
  dataProfile?: DataValueProfileSummary
  upstream: { urn: string; name: string; sensitive: boolean; kind?: LineageAssetKind }[]
  downstream: { urn: string; name: string; sensitive: boolean; kind?: LineageAssetKind }[]
  freshness: { capturedAt: string; expiresAt: string; stale: boolean }
}

type JsonRecord = Record<string, unknown>

export function sanitizeEvidenceSummary(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|token|secret|password)\s*[=:]\s*["']?)[^\s,"'}&]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
}

export function sanitizeCatalogText(value: unknown, maxLength = 1_000): string {
  if (typeof value !== 'string') return ''
  return sanitizeEvidenceSummary(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function entityUrns(payload: unknown): Set<string> {
  return new Set(array(record(payload).result).flatMap((candidate) => {
    const urn = record(candidate).urn
    return typeof urn === 'string' && urn.startsWith('urn:li:dataset:') ? [urn] : []
  }))
}

export function readStructuredToolResult(result: unknown): unknown {
  const value = record(result)
  if (value.structuredContent && typeof value.structuredContent === 'object') return value.structuredContent
  for (const item of array(value.content)) {
    const block = record(item)
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    try { return JSON.parse(block.text) } catch { /* try the next text block */ }
  }
  return {}
}

function datasetIdentity(urn: string) {
  const match = urn.match(/^urn:li:dataset:\(urn:li:dataPlatform:([^,]+),(.+),([^,]+)\)$/)
  const qualifiedName = match?.[2] ?? urn.split(',').at(-2) ?? urn
  return { platform: match?.[1] ?? 'unknown', environment: match?.[3] ?? 'unknown', name: qualifiedName.split('.').at(-1) ?? qualifiedName }
}

export function parseSearchResults(payload: unknown, maximumResults = 20): { urn: string; name: string }[] {
  const results = array(record(payload).searchResults)
  const seen = new Set<string>()
  return results.flatMap((item) => {
    const entity = record(record(item).entity)
    const urn = typeof entity.urn === 'string' ? entity.urn : ''
    if (!urn.startsWith('urn:li:dataset:') || seen.has(urn)) return []
    seen.add(urn)
    const properties = record(entity.properties)
    return [{ urn, name: sanitizeCatalogText(properties.name, 240) || datasetIdentity(urn).name }]
  }).slice(0, Math.max(0, Math.min(maximumResults, 2_000)))
}

export function parseSearchTotal(payload: unknown): number {
  const total = record(payload).total
  return Number.isInteger(total) && Number(total) >= 0 ? Math.min(Number(total), 2_000) : parseSearchResults(payload).length
}

function normalizedType(value: unknown): 'string' | 'number' | 'boolean' | 'timestamp' {
  const type = typeof value === 'string' ? value.toLowerCase() : ''
  if (/int|number|decimal|float|double/.test(type)) return 'number'
  if (/bool/.test(type)) return 'boolean'
  if (/date|time/.test(type)) return 'timestamp'
  return 'string'
}

const failedQualityResults = new Set(['FAIL', 'FAILED', 'FAILURE', 'ERROR', 'CRITICAL'])
const healthyQualityResults = new Set(['PASS', 'PASSED', 'SUCCESS', 'SUCCEEDED'])

function qualityResultValues(value: unknown, results: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => qualityResultValues(entry, results))
    return results
  }
  const candidate = record(value)
  Object.entries(candidate).forEach(([key, entry]) => {
    if (['result', 'status', 'type'].includes(key.toLowerCase())) {
      if (typeof entry === 'string') results.push(entry.trim().toUpperCase())
      else {
        const nested = record(entry)
        ;['type', 'status', 'result'].forEach((nestedKey) => {
          if (typeof nested[nestedKey] === 'string') results.push(nested[nestedKey].trim().toUpperCase())
        })
      }
    }
    if (typeof entry === 'object' && entry !== null) qualityResultValues(entry, results)
  })
  return results
}

export function qualityStatusFromEntity(entityValue: unknown): DataHubAssetSummary['qualityStatus'] {
  const entity = record(entityValue)
  const qualityRoots = [entity.assertions, entity.quality, entity.dataQuality, entity.health]
    .filter((value) => value !== undefined && value !== null)
  const results = qualityRoots.flatMap((value) => qualityResultValues(value))
  if (results.some((value) => failedQualityResults.has(value))) return 'failing'
  if (results.some((value) => healthyQualityResults.has(value))) return 'healthy'
  return 'unavailable'
}

function names(values: unknown[], resolver: (value: JsonRecord) => unknown): string[] {
  return [...new Set(values.map((value) => sanitizeCatalogText(resolver(record(value)), 160)).filter(Boolean))]
}

function directClassificationNames(values: unknown[]): string[] {
  return values.flatMap((value) => {
    if (typeof value === 'string') return sanitizeCatalogText(value, 160) || []
    const candidate = record(value)
    const properties = record(candidate.properties)
    return sanitizeCatalogText(properties.name ?? candidate.name ?? candidate.urn, 160) || []
  })
}

function fieldClassificationNames(field: JsonRecord): string[] {
  const globalTags = record(field.globalTags)
  const tags = array(globalTags.tags).length ? globalTags : record(field.tags)
  const glossaryTerms = record(field.glossaryTerms)
  return [
    ...directClassificationNames([...array(field.editedTags), ...array(field.editedGlossaryTerms)]),
    ...names(array(tags.tags), (entry) => {
      const tag = record(entry.tag)
      return record(tag.properties).name ?? tag.name ?? tag.urn
    }),
    ...names(array(glossaryTerms.terms), (entry) => {
      const term = record(entry.term)
      return record(term.properties).name ?? term.name ?? term.urn
    }),
  ]
}

function lineageKind(urn: string): LineageAssetKind {
  if (urn.startsWith('urn:li:dataset:')) return 'dataset'
  if (urn.startsWith('urn:li:mlFeature:') || urn.startsWith('urn:li:mlFeatureTable:')) return 'feature'
  if (urn.startsWith('urn:li:mlModel:') || urn.startsWith('urn:li:mlModelGroup:')) return 'model'
  if (urn.startsWith('urn:li:mlModelDeployment:') || urn.startsWith('urn:li:deployment:')) return 'deployment'
  if (urn.startsWith('urn:li:dataJob:') || urn.startsWith('urn:li:dataFlow:')) return 'pipeline'
  return 'unknown'
}

function lineageName(urn: string) {
  if (urn.startsWith('urn:li:dataset:')) return datasetIdentity(urn).name
  const compact = urn.replace(/^urn:li:[^:]+:/, '').replace(/^\(|\)$/g, '')
  return sanitizeCatalogText(compact.split(',').at(-2) ?? compact.split(':').at(-1) ?? compact, 240)
}

function findLineageUrns(value: unknown, found = new Map<string, boolean>(), depth = 0): Map<string, boolean> {
  if (depth > 12 || !value || typeof value !== 'object') return found
  if (Array.isArray(value)) {
    for (const item of value) findLineageUrns(item, found, depth + 1)
    return found
  }
  const current = value as JsonRecord
  const sensitive = /pii|sensitive|personal|gdpr/i.test(JSON.stringify(current))
  for (const item of Object.values(current)) {
    if (typeof item === 'string' && item.startsWith('urn:li:') && lineageKind(item) !== 'unknown' && item.length <= 2_000) {
      found.set(item, Boolean(found.get(item)) || sensitive)
    } else findLineageUrns(item, found, depth + 1)
  }
  return found
}

function lineageAssets(payload: unknown, sourceUrn: string) {
  return [...findLineageUrns(payload)]
    .filter(([urn]) => urn !== sourceUrn)
    .slice(0, 30)
    .map(([urn, sensitive]) => ({ urn, name: lineageName(urn), sensitive, kind: lineageKind(urn) }))
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function boundedRatio(value: unknown): number | undefined {
  const number = finiteNumber(value)
  return number === undefined || number < 0 || number > 1 ? undefined : number
}

function profileTimestamp(value: JsonRecord): number {
  return finiteNumber(value.timestampMillis) ?? finiteNumber(value.timestamp) ?? 0
}

function profileFields(value: JsonRecord) {
  return array(value.fieldProfiles).map((candidate) => {
    const field = record(candidate)
    return {
      name: sanitizeCatalogText(field.fieldPath, 240),
      nullRate: boundedRatio(field.nullProportion),
      distinctCount: finiteNumber(field.uniqueCount),
      uniqueProportion: boundedRatio(field.uniqueProportion),
      mean: finiteNumber(field.mean),
      stdev: finiteNumber(field.stdev),
    }
  }).filter((field) => field.name)
}

function riskId(kind: string, field = 'dataset') {
  return `${kind}:${field}`.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').slice(0, 180)
}

export function parseDataValueProfile(entityValue: unknown): NonNullable<DataHubAssetSummary['dataProfile']> {
  const entity = record(entityValue)
  const profiles = array(entity.datasetProfiles)
    .map(record)
    .sort((left, right) => profileTimestamp(right) - profileTimestamp(left))
    .slice(0, 2)
  if (!profiles.length) return { status: 'unavailable', fields: [], risks: [] }

  const latest = profiles[0]!
  const previous = profiles[1]
  const latestFields = profileFields(latest)
  const previousByName = new Map(previous ? profileFields(previous).map((field) => [field.name, field]) : [])
  const rowCount = finiteNumber(latest.rowCount)
  const previousRowCount = previous ? finiteNumber(previous.rowCount) : undefined
  const risks: NonNullable<DataHubAssetSummary['dataProfile']>['risks'] = []

  if (rowCount === 0) {
    risks.push({
      id: riskId('empty_dataset'),
      kind: 'empty_dataset',
      severity: 'critical',
      summary: 'The latest DataHub profile reports zero rows.',
      current: 0,
      previous: previousRowCount,
    })
  }
  if (rowCount !== undefined && previousRowCount !== undefined && previousRowCount > 0) {
    const ratio = rowCount / previousRowCount
    if (ratio <= 0.5) risks.push({
      id: riskId('volume_drop'),
      kind: 'volume_drop',
      severity: 'high',
      summary: `Row volume fell ${Math.round((1 - ratio) * 100)}% between the two latest profiles.`,
      current: rowCount,
      previous: previousRowCount,
    })
    else if (ratio <= 0.8) risks.push({
      id: riskId('volume_drop'),
      kind: 'volume_drop',
      severity: 'medium',
      summary: `Row volume fell ${Math.round((1 - ratio) * 100)}% between the two latest profiles.`,
      current: rowCount,
      previous: previousRowCount,
    })
    else if (ratio >= 2) risks.push({
      id: riskId('volume_spike'),
      kind: 'volume_spike',
      severity: ratio >= 4 ? 'high' : 'medium',
      summary: `Row volume increased ${Math.round((ratio - 1) * 100)}% between the two latest profiles.`,
      current: rowCount,
      previous: previousRowCount,
    })
  }

  const summarizedFields = latestFields.map((field) => {
    const prior = previousByName.get(field.name)
    const nullDelta = field.nullRate !== undefined && prior?.nullRate !== undefined ? field.nullRate - prior.nullRate : undefined
    if (field.nullRate !== undefined && field.nullRate >= 0.99) risks.push({
      id: riskId('fully_null', field.name),
      kind: 'fully_null',
      severity: 'high',
      field: field.name,
      summary: `${field.name} is ${Math.round(field.nullRate * 100)}% null in the latest profile.`,
      current: field.nullRate,
      previous: prior?.nullRate,
    })
    else if (nullDelta !== undefined && nullDelta >= 0.1) risks.push({
      id: riskId('null_spike', field.name),
      kind: 'null_spike',
      severity: nullDelta >= 0.2 ? 'high' : 'medium',
      field: field.name,
      summary: `${field.name} null rate increased by ${Math.round(nullDelta * 100)} percentage points.`,
      current: field.nullRate,
      previous: prior?.nullRate,
    })

    if (
      field.uniqueProportion !== undefined
      && prior?.uniqueProportion !== undefined
      && prior.uniqueProportion >= 0.98
      && field.uniqueProportion <= 0.95
    ) risks.push({
      id: riskId('duplicate_drift', field.name),
      kind: 'duplicate_drift',
      severity: field.uniqueProportion <= 0.8 ? 'high' : 'medium',
      field: field.name,
      summary: `${field.name} lost expected uniqueness; possible duplicate growth requires verification.`,
      current: field.uniqueProportion,
      previous: prior.uniqueProportion,
    })

    if (field.mean !== undefined && prior?.mean !== undefined && prior.stdev !== undefined && prior.stdev > 0) {
      const standardizedShift = Math.abs(field.mean - prior.mean) / prior.stdev
      if (standardizedShift >= 2) risks.push({
        id: riskId('distribution_shift', field.name),
        kind: 'distribution_shift',
        severity: standardizedShift >= 3 ? 'high' : 'medium',
        field: field.name,
        summary: `${field.name} mean shifted by ${standardizedShift.toFixed(1)} previous standard deviations.`,
        current: field.mean,
        previous: prior.mean,
      })
    }
    return {
      ...field,
      previousNullRate: prior?.nullRate,
      previousUniqueProportion: prior?.uniqueProportion,
      previousMean: prior?.mean,
      previousStdev: prior?.stdev,
    }
  })

  const timestamp = profileTimestamp(latest)
  const previousTimestamp = previous ? profileTimestamp(previous) : 0
  return {
    status: 'available',
    capturedAt: timestamp > 0 ? new Date(timestamp).toISOString() : undefined,
    previousCapturedAt: previousTimestamp > 0 ? new Date(previousTimestamp).toISOString() : undefined,
    rowCount,
    previousRowCount,
    fields: summarizedFields.slice(0, 250),
    risks: risks
      .sort((left, right) => ({ critical: 4, high: 3, medium: 2, low: 1 }[right.severity] - { critical: 4, high: 3, medium: 2, low: 1 }[left.severity]))
      .slice(0, 12),
  }
}

export function parseAssetContext(options: { urn: string; name?: string; entityPayload?: unknown; schemaPayload?: unknown; upstreamPayload?: unknown; downstreamPayload?: unknown; capturedAt?: string; expiresAt?: string }): DataHubAssetSummary {
  const { urn } = options
  const identity = datasetIdentity(urn)
  const entityResult = array(record(options.entityPayload).result)
  const entity = record(entityResult.find((candidate) => record(candidate).urn === urn) ?? entityResult[0])
  const properties = record(entity.properties)
  const editableProperties = record(entity.editableProperties)
  const platform = record(entity.platform)
  const ownership = record(entity.ownership)
  const owners = names(array(ownership.owners), (entry) => {
    const owner = record(entry.owner)
    const ownerProperties = record(owner.properties)
    const ownerInfo = record(owner.info)
    return ownerProperties.displayName ?? ownerInfo.displayName ?? owner.name ?? owner.urn
  })
  const tagContainer = record(entity.tags)
  const tags = names(array(tagContainer.tags), (entry) => record(record(entry).tag).properties ? record(record(record(entry).tag).properties).name : record(record(entry).tag).urn)
  const termContainer = record(entity.glossaryTerms)
  const terms = names(array(termContainer.terms), (entry) => record(record(record(entry).term).properties).name)
  const domain = record(record(entity.domain).domain)
  const domainName = record(domain.properties).name
  const schema = record(options.schemaPayload)
  const entitySchema = record(entity.schemaMetadata)
  const legacyEntitySchema = record(entity.schema)
  const schemaFields = array(schema.fields).length
    ? array(schema.fields)
    : array(entitySchema.fields).length
      ? array(entitySchema.fields)
      : array(legacyEntitySchema.fields)
  const editableSchema = record(entity.editableSchemaMetadata)
  const editableFieldsByPath = new Map(array(editableSchema.editableSchemaFieldInfo).flatMap((value) => {
    const field = record(value)
    const fieldPath = sanitizeCatalogText(field.fieldPath, 240)
    return fieldPath ? [[fieldPath, field] as const] : []
  }))
  const fields = schemaFields.map((value) => {
    const field = record(value)
    const fieldPath = sanitizeCatalogText(field.fieldPath, 240)
    const editableField = editableFieldsByPath.get(fieldPath)
    const fieldTags = [...new Set([
      ...fieldClassificationNames(field),
      ...(editableField ? fieldClassificationNames(editableField) : []),
    ])]
    return { name: fieldPath, type: normalizedType(field.nativeDataType), tags: fieldTags.length ? fieldTags : undefined }
  }).filter((field) => field.name).slice(0, 250)
  const capturedAt = options.capturedAt ?? new Date().toISOString()
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 2 * 60_000).toISOString()

  return {
    urn,
    name: sanitizeCatalogText(entity.name, 240) || sanitizeCatalogText(properties.name, 240) || sanitizeCatalogText(options.name, 240) || identity.name,
    platform: sanitizeCatalogText(platform.name, 120) || identity.platform,
    environment: identity.environment,
    description: sanitizeCatalogText(editableProperties.description, 2_000) || sanitizeCatalogText(properties.description, 2_000) || 'No description available in DataHub.',
    owners,
    domain: sanitizeCatalogText(domainName, 160) || undefined,
    tags: [...new Set([...tags, ...terms])],
    fields,
    qualityStatus: qualityStatusFromEntity(entity),
    dataProfile: parseDataValueProfile(entity),
    upstream: lineageAssets(options.upstreamPayload, urn),
    downstream: lineageAssets(options.downstreamPayload, urn),
    freshness: { capturedAt, expiresAt, stale: new Date(expiresAt).getTime() <= Date.now() },
  }
}
