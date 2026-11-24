/**
 * Where this plugin's deployment facts come from: the brand environment the shell generated, the process environment,
 * and the plugin's own Config.
 *
 * The generated file is found in one of four ways, in order: `YUNWORK_RUNTIME` names it; `process.resourcesPath` holds
 * it beside a packaged app's resources; `app.asar.unpacked/yunwork-runtime.json` sits beside the archive for processes
 * that cannot read inside it; `resources/yunwork-runtime.json` sits beside `process.execPath`, which is where an
 * installed Windows or Linux build puts it. A packaged app has nobody to set the variable, so the probe is what makes
 * shipping possible at all; when all four miss, the plugin degrades rather than guessing an origin, and the diagnosis
 * route says which path it looked at.
 *
 * The order is process environment over the runtime file over the built-in defaults, and the plugin's Config over all
 * three, because a deployment that pins an origin in the Profile means it. The runtime file is produced by
 * `yunwork-shell/scripts/prepare-brand.mjs` and carries the same sixteen fields on both sides; `version` is checked so a
 * file from a different generation fails here rather than halfway through a sign-in.
 *
 * `apiBaseUrl` and `authBaseUrl` have no default on purpose: a plugin that quietly falls back to a production domain
 * would send a user's key to a host the deployment never chose. Missing them is a start-up error with the two ways to
 * supply them spelled out.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

/** The runtime contract's generation; `prepare-brand.mjs` writes it and bumps it only for a breaking change. */
export const RUNTIME_VERSION = 1

/** Names the generated runtime file for this process. */
export const RUNTIME_VARIABLE = 'YUNWORK_RUNTIME'

/** The generated file's name, as `prepare-brand.mjs` writes it. */
export const RUNTIME_FILENAME = 'yunwork-runtime.json'

/** The two Electron locations the file can sit in when nothing names it. */
export interface RuntimePlatform {
  /** `process.resourcesPath`: the packaged app's Resources directory. */
  readonly resourcesPath?: string | undefined
  /** `process.execPath`: the executable whose sibling `resources` directory holds it on Windows and Linux. */
  readonly execPath?: string | undefined
}

/**
 * Where the runtime contract is, and whether the process named it or this probe found it.
 *
 * A process that names the file is obeyed even when the file is absent: a launcher that pinned a path meant it, and a
 * silent fall back to another location would hide the mismatch that the pin exists to prevent. Only when nothing names
 * the file does the probe look beside the executable, which is how a packaged app finds the copy the installer placed.
 *
 * @param environment - the process environment.
 * @param platform - the Electron paths, default the real process.
 * @returns the path to read, null when nothing names one and the probe found none.
 */
export function resolveRuntimePath (
  environment: NodeJS.ProcessEnv = process.env,
  platform: RuntimePlatform = process,
): { readonly path: string | null; readonly explicit: boolean } {
  const named = environment[RUNTIME_VARIABLE]?.trim()
  if (named !== undefined && named !== '') return { path: named, explicit: true }
  const candidates = [
    platform.resourcesPath === undefined || platform.resourcesPath === '' ? undefined : join(platform.resourcesPath, RUNTIME_FILENAME),
    // The Host is a separate Node process and cannot read through the application archive. `asarUnpack` writes the
    // contract beside the archive too, where this process can read it without Electron's patched file system.
    platform.resourcesPath === undefined || platform.resourcesPath === '' ? undefined : join(platform.resourcesPath, 'app.asar.unpacked', RUNTIME_FILENAME),
    platform.execPath === undefined || platform.execPath === '' ? undefined : join(dirname(platform.execPath), 'resources', RUNTIME_FILENAME),
  ]
  for (const candidate of candidates) {
    if (candidate !== undefined && existsSync(candidate)) return { path: candidate, explicit: false }
  }
  return { path: null, explicit: false }
}

/** The sixteen fields both sides agree on. */
export interface YunworkConfig {
  readonly version: 1
  readonly productName: string
  readonly shortName: string
  readonly tagline: string
  readonly appId: string
  readonly dataDirName: string
  readonly defaultLocale: string
  readonly brandColor: string
  readonly backgroundColor: string
  readonly themeColor: string
  readonly artifactPrefix: string
  readonly apiBaseUrl: string
  readonly authBaseUrl: string
  readonly insecure: boolean
  readonly updateFeedUrl: string | null
  readonly env: string
}

/** A deployment fact that is absent or unusable; the message names the field and how to supply it. */
export class YunworkConfigError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'YunworkConfigError'
  }
}

/** Brand facts that do not vary by environment, as `yunwork-shell/profiles/base.json` carries them. */
const DEFAULTS = {
  version: RUNTIME_VERSION,
  productName: '云大师 Agent',
  shortName: '云大师',
  tagline: '1 个人 + 云大师 = 一支企业',
  appId: 'com.yundashi.agent',
  dataDirName: '.yunwork',
  defaultLocale: 'zh-CN',
  brandColor: '#2D97D3',
  backgroundColor: '#F5F5F5',
  themeColor: '#2D97D3',
  artifactPrefix: 'yundashi-agent',
  insecure: false,
  updateFeedUrl: null,
  env: 'prod',
} as const

/** The process variables this plugin reads; each overrides the same field of the runtime file. */
const ENVIRONMENT: Readonly<Record<string, keyof YunworkConfig>> = {
  YUNWORK_API_BASE_URL: 'apiBaseUrl',
  YUNWORK_AUTH_BASE_URL: 'authBaseUrl',
  YUNWORK_INSECURE: 'insecure',
  YUNWORK_ENV: 'env',
}

const runtimeFileSchema = z.object({
  version: z.literal(RUNTIME_VERSION),
  productName: z.string().min(1),
  shortName: z.string().min(1),
  tagline: z.string(),
  appId: z.string().min(1),
  dataDirName: z.string().min(1),
  defaultLocale: z.string().min(1),
  brandColor: z.string().min(1),
  backgroundColor: z.string().min(1),
  themeColor: z.string().min(1),
  artifactPrefix: z.string().min(1),
  apiBaseUrl: z.string().min(1),
  authBaseUrl: z.string().min(1),
  insecure: z.boolean(),
  updateFeedUrl: z.string().nullable(),
  env: z.string().min(1),
  // The contract is exactly these sixteen keys: `yunwork-shell` pins `profileKey` on the Host side and never publishes
  // it here, so a file carrying it was not produced by this generation and is worth refusing rather than ignoring.
}).strict()

/** Options a caller may pin instead of reading them from anywhere. */
export interface DeploymentOverrides {
  readonly apiBaseUrl?: string | undefined
  readonly authBaseUrl?: string | undefined
  readonly insecure?: boolean | undefined
}

const BOOLEANS = ['1', 'true', 'yes', 'on'] as const
const FALSES = ['0', 'false', 'no', 'off'] as const

function parseBoolean (name: string, raw: string): boolean {
  const text = raw.trim().toLowerCase()
  if ((BOOLEANS as readonly string[]).includes(text)) return true
  if ((FALSES as readonly string[]).includes(text)) return false
  throw new YunworkConfigError(`${name} must be a boolean, received "${raw}"`)
}

/** Strip a trailing slash so joining a path never doubles it. */
function normalizeBaseUrl (value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function checkUrl (field: string, value: string, insecure: boolean): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new YunworkConfigError(`${field} must be an absolute URL, received "${value}"`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new YunworkConfigError(`${field} must use http or https, received "${url.protocol}"`)
  }
  // Plain http is only reachable on purpose: an intranet or loopback host, never by accident.
  if (url.protocol === 'http:' && !insecure) {
    throw new YunworkConfigError(`${field} uses plain http but insecure is not set`)
  }
  if (url.username !== '' || url.password !== '') throw new YunworkConfigError(`${field} must not carry credentials`)
}

/**
 * Read and check the generated runtime file.
 * @param raw - its parsed content.
 * @param source - its path, for the error message.
 * @returns the file's own fields.
 */
export function parseRuntimeFile (raw: unknown, source: string): YunworkConfig {
  const parsed = runtimeFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join(', ')
    const version = (raw as { version?: unknown } | undefined)?.version
    throw new YunworkConfigError(version !== undefined && version !== RUNTIME_VERSION
      ? `${source} is runtime version ${String(version)}; this plugin reads version ${RUNTIME_VERSION}. Regenerate it with yunwork-shell/scripts/prepare-brand.mjs`
      : `${source} is not a valid runtime file (${issues})`)
  }
  return parsed.data
}

/** Where the contract came from and what it claims, without insisting that it is usable. */
export interface RuntimeContractSource {
  /** Absolute path of the generated file; null when the process names none. */
  readonly path: string | null
  readonly present: boolean
  /** The version the file declares, whatever it is; null when no file was read. */
  readonly version: number | null
  /** The file's parsed content, or undefined when it is absent or unreadable. */
  readonly value: unknown
}

/**
 * Report where the contract came from and which version it declares, without throwing.
 *
 * `loadRuntimeConfig` is deliberately strict, but a diagnosis has to answer in exactly the case that strictness
 * rejects — a missing file, an unreadable one, a version this build cannot read — so this reads the same source
 * leniently and leaves every judgement to the caller.
 */
export function readRuntimeContract (
  environment: NodeJS.ProcessEnv = process.env,
  platform: RuntimePlatform = process,
): RuntimeContractSource {
  const { path } = resolveRuntimePath(environment, platform)
  if (path === null) return { path: null, present: false, version: null, value: undefined }
  if (!existsSync(path)) return { path, present: false, version: null, value: undefined }
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const version = (value as { version?: unknown } | undefined)?.version
    return { path, present: true, version: typeof version === 'number' ? version : null, value }
  } catch {
    return { path, present: true, version: null, value: undefined }
  }
}

/**
 * Resolve this deployment's configuration.
 *
 * @param options.environment - the process environment, default the real one.
 * @param options.overrides - the plugin's Config, which wins over every other source.
 * @returns the sixteen fields, with the origins checked.
 * @throws YunworkConfigError when an origin is missing or unusable.
 */
export function loadRuntimeConfig (options: {
  environment?: NodeJS.ProcessEnv
  overrides?: DeploymentOverrides
  platform?: RuntimePlatform
} = {}): YunworkConfig {
  const environment = options.environment ?? process.env
  const merged: Record<string, unknown> = { ...DEFAULTS }

  const runtime = resolveRuntimePath(environment, options.platform ?? process)
  const runtimePath = runtime.path
  if (runtimePath !== null) {
    if (!existsSync(runtimePath)) throw new YunworkConfigError(`${RUNTIME_VARIABLE} points at ${runtimePath}, which does not exist`)
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(runtimePath, 'utf8'))
    } catch (error) {
      throw new YunworkConfigError(`${runtimePath} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    Object.assign(merged, parseRuntimeFile(raw, runtimePath))
  }

  for (const [variable, field] of Object.entries(ENVIRONMENT)) {
    const raw = environment[variable]
    if (raw === undefined || raw.trim() === '') continue
    merged[field] = field === 'insecure' ? parseBoolean(variable, raw) : raw.trim()
  }

  const overrides = options.overrides ?? {}
  if (overrides.apiBaseUrl !== undefined && overrides.apiBaseUrl.trim() !== '') merged.apiBaseUrl = overrides.apiBaseUrl
  if (overrides.authBaseUrl !== undefined && overrides.authBaseUrl.trim() !== '') merged.authBaseUrl = overrides.authBaseUrl
  if (overrides.insecure !== undefined) merged.insecure = overrides.insecure

  const missing = (['apiBaseUrl', 'authBaseUrl'] as const).filter(field => typeof merged[field] !== 'string' || (merged[field] as string).trim() === '')
  if (missing.length > 0) {
    throw new YunworkConfigError(`No ${missing.join(' or ')} configured. Start the application through yunwork-shell/scripts/run.mjs, `
      + `which sets YUNWORK_RUNTIME, place ${RUNTIME_FILENAME} in the packaged app's resources directory, `
      + 'or set YUNWORK_API_BASE_URL and YUNWORK_AUTH_BASE_URL, or pin them in this plugin\'s Config.')
  }

  const insecure = merged.insecure === true
  const apiBaseUrl = normalizeBaseUrl(merged.apiBaseUrl as string)
  const authBaseUrl = normalizeBaseUrl(merged.authBaseUrl as string)
  checkUrl('apiBaseUrl', apiBaseUrl, insecure)
  checkUrl('authBaseUrl', authBaseUrl, insecure)

  return {
    ...(merged as unknown as YunworkConfig),
    apiBaseUrl,
    authBaseUrl,
    insecure,
    updateFeedUrl: typeof merged.updateFeedUrl === 'string' && merged.updateFeedUrl !== '' ? merged.updateFeedUrl : null,
  }
}
