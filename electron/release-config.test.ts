import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
  dependencies: Record<string, string>
  build: {
    asarUnpack?: string[]
    forceCodeSigning?: boolean
    generateUpdatesFilesForAllChannels?: boolean
    mac: { identity?: string; hardenedRuntime?: boolean; notarize?: boolean; icon?: string; target?: Array<{ target: string; arch: string[] }> }
    win?: { icon?: string; target?: Array<{ target: string; arch: string[] }> }
    nsis?: { oneClick?: boolean; perMachine?: boolean; allowToChangeInstallationDirectory?: boolean; shortcutName?: string }
    publish?: Array<{ provider?: string; owner?: string; repo?: string }>
  }
}

describe('macOS release configuration', () => {
  it('fails closed in production and builds both signed updater formats for both architectures', () => {
    expect(packageJson.dependencies['electron-updater']).toBeTruthy()
    expect(packageJson.build.forceCodeSigning).toBe(true)
    expect(packageJson.build.generateUpdatesFilesForAllChannels).toBe(true)
    expect(packageJson.build.mac.identity).toBeUndefined()
    expect(packageJson.build.mac.hardenedRuntime).toBe(true)
    expect(packageJson.build.mac.notarize).toBe(true)
    expect(packageJson.build.mac.icon).toBe('build/icon-1024.png')
    expect(packageJson.build.mac.target).toEqual([
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ])
    expect(packageJson.build.publish).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'github', owner: 'Complexity-ML', repo: 'sam-lab' })]))
  })

  it('keeps the ad-hoc app packaging escape hatch limited to local builds', () => {
    expect(packageJson.scripts['package:mac:dir']).toContain('-c.forceCodeSigning=false')
    expect(packageJson.scripts['package:mac:dir']).toContain('-c.mac.notarize=false')
    expect(packageJson.scripts['package:mac:release']).not.toContain('forceCodeSigning=false')
  })

  it('requires immutable stable tags, Apple secrets and native verification in CI', () => {
    const workflow = readFileSync(join(root, '.github/workflows/macos-release.yml'), 'utf8')
    expect(workflow).toContain("tags: ['v*']")
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toContain('branches: [main]')
    expect(workflow).toContain('MACOS_CERTIFICATE_P12')
    expect(workflow).toContain('APPLE_API_KEY_P8')
    expect(workflow).toContain('codesign --verify --deep --strict')
    expect(workflow).toContain('spctl --assess --type execute')
    expect(workflow).toContain('stapler validate')
  })

  it('publishes the source-first Setup for native macOS and Windows runners', () => {
    const workflow = readFileSync(join(root, '.github/workflows/setup-preview.yml'), 'utf8')
    const shellInstaller = readFileSync(join(root, 'install-sam-lab-macos.sh'), 'utf8')
    const readme = readFileSync(join(root, 'README.md'), 'utf8')
    const setupCore = readFileSync(join(root, 'apps/bootstrap-installer/src-tauri/src/lib.rs'), 'utf8')
    const setupUi = readFileSync(join(root, 'apps/bootstrap-installer/ui/components/hero-section.js'), 'utf8')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('runner: macos-15')
    expect(workflow).toContain('runner: macos-15-intel')
    expect(workflow).toContain('runner: windows-2022')
    expect(workflow).toContain('SAM-LAB-Setup-arm64.dmg')
    expect(workflow).toContain('SAM-LAB-Setup-x64.exe')
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('--prerelease')
    expect(setupCore).toContain('Complexity-ML/sam-lab')
    expect(shellInstaller).toContain('REPOSITORY="Complexity-ML/sam-lab"')
    expect(readme).toContain('github.com/Complexity-ML/sam-lab/releases/download/setup-latest')
    expect(shellInstaller).not.toContain('Complexity-ML/labo-sam')
    expect(readme).not.toContain('Complexity-ML/labo-sam')
    expect(setupCore).toContain('package:mac:dir')
    expect(setupCore).toContain('package:win:dir')
    expect(setupCore).toContain('Installing locked JavaScript dependencies')
    expect(setupCore).not.toContain('runtime:setup')
    expect(setupUi).toContain('Building Release')
    expect(setupUi).toContain('Building Main')
  })

  it('builds a Windows installer and portable updater archive without weakening production signing', () => {
    expect(packageJson.build.win?.icon).toBe('build/icon-1024.png')
    expect(packageJson.build.win?.target).toEqual([
      { target: 'nsis', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ])
    expect(packageJson.build.nsis).toMatchObject({ oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, shortcutName: 'SAM LAB' })
    expect(packageJson.build.asarUnpack).toContain('node_modules/@openai/codex-*/vendor/**/*')
    expect(packageJson.scripts['package:win:dir']).toContain('-c.forceCodeSigning=false')
    expect(packageJson.scripts['package:win:ci']).toContain('-c.forceCodeSigning=false')
  })

  it('packages and inspects Windows artifacts on a native GitHub runner', () => {
    const workflow = readFileSync(join(root, '.github/workflows/windows-smoke.yml'), 'utf8')
    expect(workflow).toContain('runs-on: windows-2022')
    expect(workflow).toContain('npm run package:win:ci')
    expect(workflow).toContain("Get-ChildItem release -Filter 'SAM-LAB-*-x64.exe'")
    expect(workflow).toContain("Get-ChildItem release -Recurse -Filter 'SAM LAB.exe'")
    expect(workflow).toContain("@openai/codex-win32-x64")
    expect(workflow).toContain("-Filter 'codex.exe'")
    expect(workflow).toContain("$info.ProductName -ne 'SAM LAB'")
  })
})
