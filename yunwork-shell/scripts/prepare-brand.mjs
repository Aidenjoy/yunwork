/**
 * Materialise the resolved brand profile as the runtime contract the desktop shell and the
 * platform plugin read at launch.
 *
 * Phase 1 ships the data and nothing else. The application name, the window icon and the bundle
 * id still come from the desktop base, so this script never writes anything electron-builder
 * consumes and never edits a tracked file: its only output is `.yunwork-build/yunwork-runtime.json`,
 * which is regenerated on every run and ignored by git. The icon assets are checked for presence
 * only, so a missing file is reported as a warning instead of failing a build that does not use it.
 *
 * The field names below are a contract: `dsh-yunwork-platform`'s env-config reads this file in
 * Phase 2 and fails on an unknown `version`.
 */
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { availableEnvironments, resolveProfile } from './resolve-profile.mjs'

const SHELL_ROOT = resolve(import.meta.dirname, '..')
const BUILD_DIRECTORY = join(SHELL_ROOT, '.yunwork-build')
const RUNTIME_FILE = join(BUILD_DIRECTORY, 'yunwork-runtime.json')
const ASSET_DIRECTORY = join(SHELL_ROOT, 'assets')

/** Bumped only when the shape of the runtime file changes in a way the reader must notice. */
const RUNTIME_VERSION = 1

/**
 * The files copied from the brand source. They are not wired into packaging yet, so a missing one
 * is a warning: the shell still runs, and the warning keeps the gap visible.
 */
const REQUIRED_ASSETS = [
  'icon.png',
  'icon-macos.png',
  'icon-windows.png',
  'icon.svg',
  'icon-macos.svg',
  'icon-windows.svg',
  'tray-windows.ico',
]

/**
 * Project the resolved profile onto the runtime contract, in a fixed key order so the generated
 * file diffs cleanly and a reader can scan it top to bottom.
 */
function toRuntime (profile) {
  return {
    version: RUNTIME_VERSION,
    productName: profile.productName,
    shortName: profile.shortName,
    tagline: profile.tagline,
    appId: profile.appId,
    dataDirName: profile.dataDirName,
    defaultLocale: profile.defaultLocale,
    brandColor: profile.brandColor,
    backgroundColor: profile.backgroundColor,
    themeColor: profile.themeColor,
    artifactPrefix: profile.artifactPrefix,
    apiBaseUrl: profile.apiBaseUrl,
    authBaseUrl: profile.authBaseUrl,
    insecure: profile.insecure === true,
    updateFeedUrl: profile.updateFeedUrl ?? null,
    env: profile.env,
  }
}

function missingAssets () {
  return REQUIRED_ASSETS.filter(file => !existsSync(join(ASSET_DIRECTORY, file)))
}

/**
 * Resolve a profile and write the runtime contract.
 *
 * @param {object} [options]
 * @param {string} [options.env] Environment name; falls back to `YUNWORK_ENV`, then `dev`.
 * @param {string} [options.outFile] Destination, default `.yunwork-build/yunwork-runtime.json`.
 * @param {(message: string) => void} [options.onWarning] Receives non-fatal notices.
 * @returns {{ runtime: object, runtimePath: string, warnings: string[] }}
 */
export function prepareBrand ({ env, outFile = RUNTIME_FILE, onWarning = () => {} } = {}) {
  const warnings = []
  const warn = message => {
    warnings.push(message)
    onWarning(message)
  }

  const profile = resolveProfile({ env, onWarning: warn })
  const runtime = toRuntime(profile)

  mkdirSync(BUILD_DIRECTORY, { recursive: true })
  const destination = resolve(outFile)
  // `--outFile` may name a directory that does not exist yet; the caller should not have to create it first.
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, `${JSON.stringify(runtime, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    // Windows ignores the mode above and the ACL it keeps is the one that matters; everywhere
    // else this narrows an existing file that a previous run left more permissive.
    chmodSync(destination, 0o600)
    if (process.platform !== 'win32' && (statSync(destination).mode & 0o077) !== 0) {
      warn(`${destination} is still group- or world-readable; the hosting filesystem rejected 0600`)
    }
  } catch (error) {
    warn(`could not restrict ${destination} to 0600: ${error instanceof Error ? error.message : String(error)}`)
  }

  for (const file of missingAssets()) warn(`missing brand asset ${join(ASSET_DIRECTORY, file)} (not used by Phase 1 packaging)`)

  return { runtime, runtimePath: destination, warnings }
}

function parseArguments (argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') { options.help = true; continue }
    if (argument === '--env') {
      options.env = argv[index + 1]
      index += 1
      if (options.env === undefined) throw new Error('--env requires a value')
      continue
    }
    if (argument.startsWith('--env=')) { options.env = argument.slice('--env='.length); continue }
    if (argument === '--out') {
      options.outFile = argv[index + 1]
      index += 1
      if (options.outFile === undefined) throw new Error('--out requires a value')
      continue
    }
    if (argument.startsWith('--out=')) { options.outFile = argument.slice('--out='.length); continue }
    throw new Error(`Unknown argument "${argument}"`)
  }
  return options
}

function usage () {
  return [
    'Usage: node prepare-brand.mjs [--env=<name>] [--out=<file>]',
    '',
    'Resolves the brand profile and writes the runtime contract the desktop shell reads:',
    `  ${RUNTIME_FILE}`,
    'Prints the written path on stdout; warnings and the missing-asset report go to stderr.',
    '',
    `Environments: ${availableEnvironments().join(', ')}`,
    'Exit codes: 0 on success, 1 on an unknown environment or an invalid profile.',
  ].join('\n')
}

function main (argv) {
  const options = parseArguments(argv)
  if (options.help === true) {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  const result = prepareBrand({
    env: options.env,
    outFile: options.outFile,
    onWarning: message => process.stderr.write(`prepare-brand: ${message}\n`),
  })
  process.stdout.write(`${result.runtimePath}\n`)
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`prepare-brand: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
