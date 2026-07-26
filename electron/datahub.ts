export interface DataHubStatus {
  mode: 'demo' | 'connected'
  url?: string
  message: string
}

export interface DataHubDatasetContext {
  urn: string
  name: string
  description?: string
  platform?: string
  owners: string[]
  tags: string[]
  fields: { name: string; type: 'string' | 'number' | 'boolean' | 'timestamp'; tags?: string[] }[]
}

function configuration() {
  const url = process.env.DATAHUB_GMS_URL?.trim().replace(/\/$/, '')
  const token = process.env.DATAHUB_GMS_TOKEN?.trim()
  return { url, token }
}

export function getDataHubStatus(): DataHubStatus {
  const { url, token } = configuration()
  if (!url || !token) return {
    mode: 'demo',
    message: 'Demo catalog active. Set DATAHUB_GMS_URL and DATAHUB_GMS_TOKEN before launching Electron to connect.',
  }
  return { mode: 'connected', url, message: `DataHub configured at ${url}` }
}

function normalizedType(nativeType: string | undefined): 'string' | 'number' | 'boolean' | 'timestamp' {
  const value = nativeType?.toLowerCase() ?? ''
  if (/int|number|decimal|float|double/.test(value)) return 'number'
  if (/bool/.test(value)) return 'boolean'
  if (/date|time/.test(value)) return 'timestamp'
  return 'string'
}

interface GraphQLDatasetResponse {
  data?: {
    dataset?: {
      urn: string
      name: string
      platform?: { name?: string }
      properties?: { description?: string }
      ownership?: { owners?: { owner?: { urn?: string } }[] }
      globalTags?: { tags?: { tag?: { urn?: string } }[] }
      schemaMetadata?: {
        fields?: {
          fieldPath: string
          nativeDataType?: string
          globalTags?: { tags?: { tag?: { urn?: string } }[] }
        }[]
      }
    }
  }
  errors?: { message?: string }[]
}

function shortUrn(value: string | undefined): string | undefined {
  if (!value) return undefined
  const tail = value.split(':').pop()
  return tail?.replace(/[()]/g, '')
}

export async function loadDatasetContext(urn: string): Promise<DataHubDatasetContext> {
  if (!urn.startsWith('urn:li:dataset:') || urn.length > 2_000) throw new Error('A valid DataHub dataset URN is required')
  const { url, token } = configuration()
  if (!url || !token) throw new Error('DataHub is not configured')

  const query = `query DataLabDataset($urn: String!) {
    dataset(urn: $urn) {
      urn
      name
      platform { name }
      properties { description }
      ownership { owners { owner { urn } } }
      globalTags { tags { tag { urn } } }
      schemaMetadata {
        fields {
          fieldPath
          nativeDataType
          globalTags { tags { tag { urn } } }
        }
      }
    }
  }`

  const response = await fetch(`${url}/api/graphql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { urn } }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`DataHub returned HTTP ${response.status}`)
  const payload = await response.json() as GraphQLDatasetResponse
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).filter(Boolean).join('; '))
  const dataset = payload.data?.dataset
  if (!dataset) throw new Error('Dataset was not found in DataHub')

  return {
    urn: dataset.urn,
    name: dataset.name,
    description: dataset.properties?.description,
    platform: dataset.platform?.name,
    owners: (dataset.ownership?.owners ?? []).map((entry) => shortUrn(entry.owner?.urn)).filter((value): value is string => Boolean(value)),
    tags: (dataset.globalTags?.tags ?? []).map((entry) => shortUrn(entry.tag?.urn)).filter((value): value is string => Boolean(value)),
    fields: (dataset.schemaMetadata?.fields ?? []).map((field) => ({
      name: field.fieldPath,
      type: normalizedType(field.nativeDataType),
      tags: (field.globalTags?.tags ?? []).map((entry) => shortUrn(entry.tag?.urn)).filter((value): value is string => Boolean(value)),
    })),
  }
}
