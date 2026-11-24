/**
 * Resolve the brand profile for one environment.
 *
 * The layers are merged low to high: `base.json`, the selected `<env>.json`, the untracked
 * `local.json`, and finally `YUNWORK_*` variables from the process environment. Every layer is a
 * plain JSON object, so the merge is a shallow key overwrite: an environment file replaces whole
 * values and never patches inside one.
 *
 * Two properties keep the merge predictable:
 *
 * - Only fields that already exist in the merged layers accept an environment override, so an
 *   unrelated `YUNWORK_*` variable can never add a field to the contract. Names such as
 *   `YUNWORK_DATA_HOME` and `YUNWORK_RUNTIME` are read by `run.mjs` and deliberately fall outside
 *   that set.
 * - `profileKey` names the release brand. It is the one field no environment may move, so a
 *   build labelled `yundashi` cannot be produced as another brand by exporting a variable.
 *
 * Every failure is loud: a missing required field or a malformed value stops the process with
 * exit code 1 instead of emitting a partially valid profile.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PROFILE_DIRECTORY = resolve(import.meta.dirname, '..', 'profiles')
const BASE_FILE = 'base.json'
const LOCAL_FILE = 'local.json'

const ARTIFACT_PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const DATA_DIRECTORY_PATTERN = /^\.[a-z0-9][a-z0-9-]*$/
const APP_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/
const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/** Fields the shell and the platform plugin cannot work without. */
const REQUIRED_FIELDS = ['productName', 'appId', 'dataDirName', 'artifactPrefix', 'defaultLocale', 'apiBaseUrl', 'authBaseUrl']

/** Fields pinned to the repository, overriding layers included. */
const PINNED_FIELDS = ['profileKey']

const DEFAULT_ENVIRONMENT = 'dev'

/** A profile problem the caller is expected to report verbatim instead of recovering from. */
export class ProfileError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ProfileError'
  }
}

/** The environment names available as `<name>.json` next to `base.json`. */
export function availableEnvironments () {
  return readdirSync(PROFILE_DIRECTORY)
    .filter(file => file.endsWith('.json') && file !== BASE_FILE && file !== LOCAL_FILE)
    .map(file => file.slice(0, -'.json'.length))
    .sort()
}

function readJson (path, { required }) {
  if (!existsSync(path)) {
    if (required) throw new ProfileError(`Missing profile file: ${path}`)
    return undefined
  }
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new ProfileError(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProfileError(`${path} must contain a JSON object`)
  }
  return value
}

function chooseEnvironment (requested) {
  const environments = availableEnvironments()
  if (environments.length === 0) throw new ProfileError(`No environment profiles found in ${PROFILE_DIRECTORY}`)
  const raw = requested ?? process.env.YUNWORK_ENV ?? DEFAULT_ENVIRONMENT
  const environment = String(raw).trim()
  if (environment === '') throw new ProfileError('The environment name must not be empty')
  if (environment === BASE_FILE.slice(0, -'.json'.length) || environment === LOCAL_FILE.slice(0, -'.json'.length)) {
    throw new ProfileError(`"${environment}" is a layer, not an environment. Available: ${environments.join(', ')}`)
  }
  if (!environments.includes(environment)) {
    throw new ProfileError(`Unknown environment "${environment}". Available: ${environments.join(', ')}`)
  }
  return environment
}

/** `apiBaseUrl` becomes `YUNWORK_API_BASE_URL`, the spelling a shell can export. */
function environmentVariable (field) {
  return `YUNWORK_${field.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`
}

/**
 * Keep the type of the value being overridden. A boolean stays a boolean because `insecure` is
 * compared against `true` downstream, and a string `"false"` would read as enabled.
 */
function coerceOverride (field, raw, current) {
  const name = environmentVariable(field)
  if (typeof current === 'boolean') {
    const text = raw.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(text)) return true
    if (['0', 'false', 'no', 'off'].includes(text)) return false
    throw new ProfileError(`${name} must be a boolean, received "${raw}"`)
  }
  if (typeof current === 'number') {
    const value = Number(raw.trim())
    if (!Number.isFinite(value)) throw new ProfileError(`${name} must be a number, received "${raw}"`)
    return value
  }
  if (current === null) {
    const text = raw.trim()
    // A null URL can be cleared or set, but never silently turned into the string "null".
    return text === '' || text.toLowerCase() === 'null' ? null : text
  }
  return raw
}

function validateUrl (field, value, problems) {
  let url
  try {
    url = new URL(value)
  } catch {
    problems.push(`${field} must be an absolute URL, received "${value}"`)
    return
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    problems.push(`${field} must use http or https, received "${url.protocol}"`)
  }
}

/** Return every problem at once; a caller fixing a profile should not discover them one run at a time. */
export function validateProfile (profile) {
  const problems = []

  for (const field of REQUIRED_FIELDS) {
    const value = profile[field]
    if (typeof value !== 'string' || value.trim() === '') problems.push(`missing required field ${field}`)
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof profile[field] !== 'string' || profile[field].trim() === '') continue
    const value = profile[field]
    if (field === 'artifactPrefix' && !ARTIFACT_PREFIX_PATTERN.test(value)) {
      problems.push(`artifactPrefix must be lowercase kebab-case (${ARTIFACT_PREFIX_PATTERN}), received "${value}"`)
    }
    if (field === 'dataDirName' && !DATA_DIRECTORY_PATTERN.test(value)) {
      problems.push(`dataDirName must be a dot-prefixed lowercase directory name (${DATA_DIRECTORY_PATTERN}), received "${value}"`)
    }
    if (field === 'appId' && !APP_ID_PATTERN.test(value)) {
      problems.push(`appId must be reverse-domain notation (${APP_ID_PATTERN}), received "${value}"`)
    }
    if (field === 'defaultLocale' && !LOCALE_PATTERN.test(value)) {
      problems.push(`defaultLocale must be a BCP 47 language tag (${LOCALE_PATTERN}), received "${value}"`)
    }
  }

  if (typeof profile.apiBaseUrl === 'string' && profile.apiBaseUrl !== '') validateUrl('apiBaseUrl', profile.apiBaseUrl, problems)
  if (typeof profile.authBaseUrl === 'string' && profile.authBaseUrl !== '') validateUrl('authBaseUrl', profile.authBaseUrl, problems)

  if (profile.insecure !== undefined && typeof profile.insecure !== 'boolean') {
    problems.push(`insecure must be a boolean, received ${JSON.stringify(profile.insecure)}`)
  }

  if (profile.updateFeedUrl !== undefined && profile.updateFeedUrl !== null) {
    if (typeof profile.updateFeedUrl !== 'string' || profile.updateFeedUrl.trim() === '') {
      problems.push('updateFeedUrl must be an absolute https URL or null')
    } else {
      validateUrl('updateFeedUrl', profile.updateFeedUrl, problems)
      if (!profile.updateFeedUrl.startsWith('https://')) problems.push('updateFeedUrl must use https')
    }
  }

  // Plain http is only reachable on purpose: an intranet or loopback host, never a release build.
  for (const field of ['apiBaseUrl', 'authBaseUrl']) {
    const value = profile[field]
    if (typeof value === 'string' && value.startsWith('http://') && profile.insecure !== true) {
      problems.push(`${field} uses plain http but insecure is not true`)
    }
  }

  return problems
}

function normaliseBaseUrl (value) {
  return typeof value === 'string' ? value.replace(/\/+$/, '') : value
}

/**
 * Merge the layers for one environment and validate the result.
 *
 * @param {object} [options]
 * @param {string} [options.env] Environment name; falls back to `YUNWORK_ENV`, then `dev`.
 * @param {NodeJS.ProcessEnv} [options.environment] Override source, default the process environment.
 * @param {(message: string) => void} [options.onWarning] Receives non-fatal notices.
 * @returns {object} The merged, validated profile, including the resolved `env`.
 */
export function resolveProfile ({ env, environment = process.env, onWarning = () => {} } = {}) {
  const selected = chooseEnvironment(env)

  const base = readJson(join(PROFILE_DIRECTORY, BASE_FILE), { required: true })
  const environmentProfile = readJson(join(PROFILE_DIRECTORY, `${selected}.json`), { required: true })
  const local = readJson(join(PROFILE_DIRECTORY, LOCAL_FILE), { required: false })

  const layers = [[BASE_FILE, base], [`${selected}.json`, environmentProfile]]
  if (local !== undefined) layers.push([LOCAL_FILE, local])

  const merged = {}
  for (const [source, layer] of layers) {
    for (const [field, value] of Object.entries(layer)) {
      // `env` is derived from the file name, so a layer that spells it out is only confusing.
      if (field === 'env') continue
      if (PINNED_FIELDS.includes(field) && source !== BASE_FILE) {
        if (merged[field] !== value) onWarning(`${source}: ignored ${field} (pinned to ${BASE_FILE})`)
        continue
      }
      merged[field] = value
    }
  }

  // Environment overrides come last, and only for fields the layers already declared.
  for (const field of Object.keys(merged)) {
    if (PINNED_FIELDS.includes(field)) continue
    const raw = environment[environmentVariable(field)]
    if (raw === undefined) continue
    merged[field] = coerceOverride(field, raw, merged[field])
  }

  for (const field of ['apiBaseUrl', 'authBaseUrl', 'updateFeedUrl']) {
    if (merged[field] !== undefined && merged[field] !== null) merged[field] = normaliseBaseUrl(merged[field])
  }

  const problems = validateProfile(merged)
  if (problems.length > 0) throw new ProfileError(`Invalid profile for environment "${selected}":\n  - ${problems.join('\n  - ')}`)

  merged.env = selected
  return merged
}

function parseArguments (argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') { options.help = true; continue }
    if (argument === '--env') {
      options.env = argv[index + 1]
      index += 1
      if (options.env === undefined) throw new ProfileError('--env requires a value')
      continue
    }
    if (argument.startsWith('--env=')) { options.env = argument.slice('--env='.length); continue }
    throw new ProfileError(`Unknown argument "${argument}"`)
  }
  return options
}

function usage () {
  return [
    'Usage: node resolve-profile.mjs [--env=<name>]',
    '',
    'Prints the merged brand profile for one environment as JSON on stdout.',
    `Layers merge base.json < <env>.json < local.json < YUNWORK_* environment variables.`,
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
  const profile = resolveProfile({ env: options.env, onWarning: message => process.stderr.write(`resolve-profile: ${message}\n`) })
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`)
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`resolve-profile: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
