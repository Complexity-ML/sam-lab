import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const electron = require('electron')
const probe = join(root, 'scripts', 'verify-electron-load-probe.mjs')
const result = spawnSync(electron, [probe], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  timeout: 15_000,
})

if (result.error) throw result.error
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || `Electron import probe exited with ${result.status}\n`)
  process.exit(result.status ?? 1)
}
process.stdout.write(result.stdout)
