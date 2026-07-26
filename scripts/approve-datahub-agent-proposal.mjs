#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argumentsMap = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=')
  return [key.replace(/^--/, ''), value.length ? value.join('=') : 'true']
}))
if (!argumentsMap.has('approve-reviewed-diff')) {
  throw new Error('Approval is disabled. Inspect the pending provider artifact and re-run with --approve-reviewed-diff only after accepting its exact card and edge diff.')
}

const pendingPath = resolve(root, argumentsMap.get('input') || 'examples/datahub-oss/provider-proposal.pending.json')
const outputPath = resolve(root, argumentsMap.get('output') || 'examples/datahub-oss/provider-reviewed-workflow.json')
if (!existsSync(pendingPath)) throw new Error(`Pending provider artifact not found: ${pendingPath}`)
const pending = JSON.parse(readFileSync(pendingPath, 'utf8'))
if (pending?.schemaVersion !== 1 || pending?.status !== 'pending-human-review' || !pending?.proposal || !pending?.request || !pending?.initialGraph) {
  throw new Error('Pending provider artifact does not match the SAM LAB review contract')
}

const candidatePath = `${outputPath}.candidate.json`
const reviewed = {
  ...pending,
  status: 'approved-pending-validation',
  review: {
    decision: 'approved',
    reviewedAt: new Date().toISOString(),
    reviewer: argumentsMap.get('reviewer') || 'SAM LAB operator',
    acknowledgement: 'The exact provider card and edge diff was reviewed before atomic validation.',
  },
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(candidatePath, `${JSON.stringify(reviewed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })

const vitest = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest')
const validation = spawnSync(vitest, ['run', 'tests/provider-backed-workflow.test.ts'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, DATA_LAB_PROVIDER_ARTIFACT: candidatePath },
  timeout: 60_000,
})
if (validation.error || validation.status !== 0) {
  unlinkSync(candidatePath)
  process.stderr.write(validation.stderr || validation.stdout || String(validation.error))
  throw new Error('Atomic provider workflow validation failed; pending proposal preserved and active graph unchanged')
}

reviewed.status = 'approved-and-validated'
reviewed.atomicValidation = {
  passed: true,
  validator: 'tests/provider-backed-workflow.test.ts',
  directUnprotectedEdgePresent: false,
  beforeHumanDecision: 'waiting',
  afterApproval: 'completed',
}
const finalTemporaryPath = `${outputPath}.tmp`
writeFileSync(finalTemporaryPath, `${JSON.stringify(reviewed, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 })
renameSync(finalTemporaryPath, outputPath)
unlinkSync(candidatePath)
unlinkSync(pendingPath)
process.stdout.write(validation.stdout)
process.stdout.write(`${JSON.stringify({ status: reviewed.status, output: outputPath, reviewedAt: reviewed.review.reviewedAt, actions: reviewed.proposal.actions.length }, null, 2)}\n`)
