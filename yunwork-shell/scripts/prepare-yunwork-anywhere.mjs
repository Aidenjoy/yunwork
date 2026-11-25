/**
 * Build `@agents-anywhere/dsh-bridge-next` from our own `yuncontrol` repository and place a
 * commit-fingerprinted tarball + `anywhere-provenance.json` into `vendor/yundashi/`.
 *
 * Never touches `vendor/agents-anywhere/`.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SHELL_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(SHELL_ROOT, '..')
const VENDOR_DIR = join(REPOSITORY_ROOT, 'vendor', 'yundashi')
const DEFAULT_ANYWHERE_REPO = resolve(REPOSITORY_ROOT, '..', 'yuncontrol')

function parseArguments (argv) {
  let source
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--source' && argv[i + 1] !== undefined) { source = argv[++i]; continue }
    if (arg.startsWith('--source=')) { source = arg.slice('--source='.length); continue }
  }
  return resolve(source ?? process.env.YUNWORK_ANYWHERE_REPO ?? DEFAULT_ANYWHERE_REPO)
}

function run (command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

function main (argv) {
  const repoRoot = parseArguments(argv)
  const bridgeDir = join(repoRoot, 'dsh-bridge-next')
  if (!existsSync(join(bridgeDir, 'package.json'))) {
    throw new Error(`Missing dsh-bridge-next in ${repoRoot}`)
  }

  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'dsh-bridge-next', 'connector'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  if (dirty !== '') {
    throw new Error(`Refusing to pack dirty yuncontrol tree:\n${dirty}`)
  }

  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const shortCommit = commit.slice(0, 12)

  process.stdout.write(`prepare-yunwork-anywhere: building dsh-bridge-next from ${bridgeDir} (${shortCommit})\n`)
  run('node', ['scripts/clean.ts'], bridgeDir)
  run('npx', ['tsdown'], bridgeDir)
  run('node', ['scripts/bundle-connector.ts'], bridgeDir)
  run('node', ['scripts/check-build.ts'], bridgeDir)

  const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--silent'], { cwd: bridgeDir, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split(/\r?\n/).pop()
  if (!packed || !existsSync(join(bridgeDir, packed))) {
    throw new Error(`npm pack did not produce a tarball in ${bridgeDir}`)
  }

  const bytes = readFileSync(join(bridgeDir, packed))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const pkg = JSON.parse(readFileSync(join(bridgeDir, 'package.json'), 'utf8'))
  const filename = `agents-anywhere-dsh-bridge-next-${pkg.version}-desktop.c${shortCommit}.r${sha256.slice(0, 8)}.tgz`

  mkdirSync(VENDOR_DIR, { recursive: true })
  for (const existing of readdirSync(VENDOR_DIR)) {
    if (existing.startsWith('agents-anywhere-dsh-bridge-next-') && existing.endsWith('.tgz')) {
      rmSync(join(VENDOR_DIR, existing), { force: true })
    }
  }

  const dest = join(VENDOR_DIR, filename)
  renameSync(join(bridgeDir, packed), dest)

  const provenance = {
    repository: 'yuncontrol',
    commit,
    builtAt: new Date().toISOString(),
    filename,
    sha256,
    runtimePackage: pkg.name,
    version: pkg.version,
  }
  writeFileSync(join(VENDOR_DIR, 'anywhere-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8')
  process.stdout.write(`prepare-yunwork-anywhere: wrote ${dest}\n`)
}

main(process.argv.slice(2))
