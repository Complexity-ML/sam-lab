#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const outputDirectory = fileURLToPath(new URL('./data/', import.meta.url))
const referenceDate = new Date('2026-07-26T00:00:00.000Z')
const seatCount = 250
const purchasedSeats = 300
const monthlyUnitCost = 19
const teams = [
  ['Engineering', 'CC-ENG'],
  ['Data', 'CC-DATA'],
  ['Product', 'CC-PROD'],
  ['Security', 'CC-SEC'],
  ['Customer Success', 'CC-CS'],
  ['Operations', 'CC-OPS'],
]

function userKey(index) {
  return `usr_${createHash('sha256').update(`sam-lab-copilot-demo:${index}`).digest('hex').slice(0, 16)}`
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function daysBefore(days) {
  const date = new Date(referenceDate)
  date.setUTCDate(date.getUTCDate() - days)
  date.setUTCHours(8 + (days % 9), (days * 7) % 60, 0, 0)
  return date.toISOString()
}

function csv(rows) {
  return `${rows.map((row) => row.map((value) => {
    if (value === null || value === undefined) return ''
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }).join(',')).join('\n')}\n`
}

const seats = [['user_key', 'assigned_at', 'plan_type', 'assigning_team', 'seat_status', 'pending_cancellation_date']]
const usage = [['user_key', 'captured_at', 'last_activity_at', 'last_authenticated_at', 'active_days_28d', 'chat_requests', 'code_completions', 'agent_requests', 'accepted_suggestions']]
const employees = [['user_key', 'department', 'cost_center', 'employment_status', 'critical_access']]

let active30d = 0
let inactive30To59d = 0
let inactive60d = 0
let neverActive = 0
let criticalReclaimCandidates = 0

for (let index = 1; index <= seatCount; index += 1) {
  const key = userKey(index)
  const [department, costCenter] = teams[(index - 1) % teams.length]
  const assignedDaysAgo = 30 + ((index * 11) % 420)
  const assignedAt = isoDate(new Date(referenceDate.getTime() - assignedDaysAgo * 86_400_000))
  const criticalAccess = index % 23 === 0
  const employmentStatus = index >= 247 ? 'leaving' : 'active'
  const pendingCancellationDate = index >= 247 ? '2026-08-01' : null

  let lastActivityAt = null
  let activeDays = 0
  if (index <= 178) {
    const daysAgo = index % 29
    lastActivityAt = daysBefore(daysAgo)
    activeDays = 4 + (index % 18)
    active30d += 1
  } else if (index <= 208) {
    const daysAgo = 31 + (index % 29)
    lastActivityAt = daysBefore(daysAgo)
    inactive30To59d += 1
  } else if (index <= 244) {
    const daysAgo = 61 + (index % 89)
    lastActivityAt = daysBefore(daysAgo)
    inactive60d += 1
    if (criticalAccess) criticalReclaimCandidates += 1
  } else {
    neverActive += 1
    if (criticalAccess) criticalReclaimCandidates += 1
  }

  const usageWeight = Math.max(0, activeDays)
  seats.push([key, assignedAt, 'business', department, pendingCancellationDate ? 'pending_cancellation' : 'assigned', pendingCancellationDate])
  usage.push([
    key,
    isoDate(referenceDate),
    lastActivityAt,
    daysBefore(index % 14),
    usageWeight,
    usageWeight * (2 + (index % 5)),
    usageWeight * (8 + (index % 13)),
    usageWeight * (index % 4),
    usageWeight * (3 + (index % 7)),
  ])
  employees.push([key, department, costCenter, employmentStatus, criticalAccess])
}

const contracts = [
  ['product_key', 'vendor', 'product', 'plan_type', 'purchased_seats', 'monthly_unit_cost', 'currency', 'renewal_date', 'contract_owner', 'approved', 'captured_at'],
  ['github-copilot-business', 'GitHub', 'GitHub Copilot', 'business', purchasedSeats, monthlyUnitCost, 'USD', '2026-10-15', 'Developer Platform', true, isoDate(referenceDate)],
]

const reclaimCandidates = inactive60d + neverActive
const annualUnitCost = monthlyUnitCost * 12
const summary = {
  schemaVersion: 1,
  generatedAt: referenceDate.toISOString(),
  product: 'GitHub Copilot Business',
  privacy: {
    synthetic: true,
    directIdentifiers: false,
    userKey: 'deterministic SHA-256 pseudonym',
  },
  seats: {
    purchased: purchasedSeats,
    assigned: seatCount,
    unassigned: purchasedSeats - seatCount,
    active30d,
    inactive30To59d,
    inactive60d,
    neverActive,
    reclaimCandidates,
    criticalReclaimCandidates,
  },
  cost: {
    currency: 'USD',
    monthlyUnitCost,
    annualUnitCost,
    annualSpend: purchasedSeats * annualUnitCost,
    activeGapAnnualized: (purchasedSeats - active30d) * annualUnitCost,
    eligibleReclaimAnnualized: (reclaimCandidates - criticalReclaimCandidates) * annualUnitCost,
  },
}

await mkdir(outputDirectory, { recursive: true })
await Promise.all([
  writeFile(new URL('./data/copilot_seats.csv', import.meta.url), csv(seats)),
  writeFile(new URL('./data/copilot_usage_28d.csv', import.meta.url), csv(usage)),
  writeFile(new URL('./data/employee_directory.csv', import.meta.url), csv(employees)),
  writeFile(new URL('./data/software_contracts.csv', import.meta.url), csv(contracts)),
  writeFile(new URL('./data/expected-summary.json', import.meta.url), `${JSON.stringify(summary, null, 2)}\n`),
])

process.stdout.write(`Generated ${seatCount} pseudonymized Copilot seat records in ${outputDirectory}\n`)
