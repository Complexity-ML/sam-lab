#!/usr/bin/env node

const baseUrl = (process.env.DATAHUB_GMS_URL || 'http://localhost:8080').replace(/\/+$/, '')
const endpoint = new URL('/api/graphql', baseUrl)
const token = process.env.DATAHUB_GMS_TOKEN?.trim()
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1'])

if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('DataHub must use HTTP or HTTPS')
if (token && endpoint.protocol !== 'https:' && !loopbackHosts.has(endpoint.hostname)) {
  throw new Error('Refusing to send a DataHub token over insecure non-loopback HTTP')
}

const headers = {
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
}

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`DataHub returned HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join(' | '))
  return payload.data
}

async function exists(urn) {
  const data = await graphql('query Exists($urn: String!) { entity(urn: $urn) { urn } }', { urn })
  return Boolean(data.entity?.urn)
}

const groups = [
  {
    id: 'developer-platform',
    urn: 'urn:li:corpGroup:developer-platform',
    name: 'Developer Platform',
    description: 'Owner of GitHub Copilot licensing and usage evidence for the SAM LAB demo.',
  },
  {
    id: 'procurement',
    urn: 'urn:li:corpGroup:procurement',
    name: 'Procurement',
    description: 'Owner of contract and renewal evidence for the SAM LAB demo.',
  },
]

const tags = [
  ['SAM', 'Software Asset Management evidence.'],
  ['Synthetic', 'Deterministic synthetic demonstration data.'],
  ['Pseudonymized', 'Direct user identifiers are replaced with bounded pseudonyms.'],
  ['LicenseAssignment', 'Software license assignment evidence.'],
  ['AggregateUsage', 'Bounded usage aggregates without prompts, source code or raw events.'],
  ['Restricted', 'Access should remain limited to approved reviewers.'],
  ['Contract', 'Software contract and entitlement evidence.'],
  ['LicenseUsage', 'Product-level purchased, assigned and active seat metrics.'],
  ['HumanReviewRequired', 'A human owner must review the recommendation before external action.'],
  ['Renewal', 'Software renewal planning evidence.'],
]

for (const group of groups) {
  if (await exists(group.urn)) continue
  await graphql(
    'mutation CreateGroup($input: CreateGroupInput!) { createGroup(input: $input) }',
    { input: { id: group.id, name: group.name, description: group.description } },
  )
}

for (const [name, description] of tags) {
  const urn = `urn:li:tag:${name}`
  if (await exists(urn)) {
    await graphql(
      'mutation UpdateTag($urn: String!, $input: TagUpdateInput!) { updateTag(urn: $urn, input: $input) { urn } }',
      { urn, input: { urn, name, description } },
    )
  } else {
    await graphql(
      'mutation CreateTag($input: CreateTagInput!) { createTag(input: $input) }',
      { input: { id: name, name, description } },
    )
  }
}

process.stdout.write(`DataHub metadata ready: ${groups.length} owner groups and ${tags.length} governed tags at ${baseUrl}\n`)
