#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

const root = new URL('../examples/sam-copilot-datahub/', import.meta.url)

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const headers = lines.shift().split(',')
  return lines.map((line) => {
    const values = line.split(',')
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const [seatText, usageText, employeeText, contractText, expectedText, viewsSql, recipe, enrichment] = await Promise.all([
  readFile(new URL('./data/copilot_seats.csv', root), 'utf8'),
  readFile(new URL('./data/copilot_usage_28d.csv', root), 'utf8'),
  readFile(new URL('./data/employee_directory.csv', root), 'utf8'),
  readFile(new URL('./data/software_contracts.csv', root), 'utf8'),
  readFile(new URL('./data/expected-summary.json', root), 'utf8'),
  readFile(new URL('./sql/10_views.sql', root), 'utf8'),
  readFile(new URL('./datahub-ingestion.yml', root), 'utf8'),
  readFile(new URL('./metadata-enrichment.csv', root), 'utf8'),
])

const seats = parseCsv(seatText)
const usage = parseCsv(usageText)
const employees = parseCsv(employeeText)
const contracts = parseCsv(contractText)
const expected = JSON.parse(expectedText)
const keys = new Set(seats.map((seat) => seat.user_key))

assert(seats.length === expected.seats.assigned, `Expected ${expected.seats.assigned} seat rows`)
assert(usage.length === seats.length && employees.length === seats.length, 'Every seat must have usage and employee evidence')
assert(contracts.length === 1, 'The demo requires exactly one bounded contract')
assert(keys.size === seats.length, 'Seat pseudonyms must be unique')
assert(usage.every((row) => keys.has(row.user_key)), 'Usage contains an unknown user pseudonym')
assert(employees.every((row) => keys.has(row.user_key)), 'Employee evidence contains an unknown user pseudonym')
assert(!/@/.test(`${seatText}\n${usageText}\n${employeeText}`), 'Direct email-like identifiers are forbidden')
assert(seats.every((seat) => /^usr_[a-f0-9]{16}$/.test(seat.user_key)), 'Every user key must be a bounded pseudonym')

const capturedAt = new Date(`${usage[0].captured_at}T00:00:00.000Z`)
const daysSince = (value) => Math.floor((capturedAt.getTime() - new Date(`${value.slice(0, 10)}T00:00:00.000Z`).getTime()) / 86_400_000)
const active30d = usage.filter((row) => row.last_activity_at && daysSince(row.last_activity_at) <= 30).length
const inactive30To59d = usage.filter((row) => row.last_activity_at && daysSince(row.last_activity_at) >= 31 && daysSince(row.last_activity_at) <= 59).length
const inactive60d = usage.filter((row) => row.last_activity_at && daysSince(row.last_activity_at) >= 60).length
const neverActive = usage.filter((row) => !row.last_activity_at).length
const candidateKeys = new Set(usage.filter((row) => !row.last_activity_at || daysSince(row.last_activity_at) >= 60).map((row) => row.user_key))
const criticalCandidates = employees.filter((row) => candidateKeys.has(row.user_key) && row.critical_access === 'true').length

assert(active30d === expected.seats.active30d, 'Active 30-day population does not match the expected checkpoint')
assert(inactive30To59d === expected.seats.inactive30To59d, '31-59 day population does not match the expected checkpoint')
assert(inactive60d === expected.seats.inactive60d, '60-day population does not match the expected checkpoint')
assert(neverActive === expected.seats.neverActive, 'Never-active population does not match the expected checkpoint')
assert(candidateKeys.size === expected.seats.reclaimCandidates, 'Reclaim candidate count does not match the expected checkpoint')
assert(criticalCandidates === expected.seats.criticalReclaimCandidates, 'Critical candidates must remain review-only')

for (const relation of [
  'sam_raw.copilot_seats',
  'sam_raw.copilot_usage_28d',
  'sam_raw.employee_directory',
  'sam_raw.software_contracts',
  'sam_mart.license_assignment_snapshot',
  'sam_mart.license_utilization',
  'sam_mart.reclaim_candidates',
  'sam_mart.renewal_risk',
]) {
  assert(viewsSql.includes(relation) || relation.startsWith('sam_raw.'), `Lineage SQL is missing ${relation}`)
}
assert(recipe.includes('include_view_lineage: true'), 'DataHub view lineage must be enabled')
assert(recipe.includes('enabled: true'), 'DataHub profiling must be enabled')
assert(enrichment.includes('urn:li:tag:HumanReviewRequired'), 'The reclaim queue must be tagged for human review')
assert(enrichment.includes('urn:li:corpGroup:developer-platform'), 'The primary SAM assets must have a responsible owner')

process.stdout.write(`${JSON.stringify({
  ok: true,
  assignedSeats: seats.length,
  active30d,
  reclaimCandidates: candidateKeys.size,
  criticalCandidates,
  eligibleAnnualSavings: expected.cost.eligibleReclaimAnnualized,
  rawIdentifiersCaptured: false,
}, null, 2)}\n`)
