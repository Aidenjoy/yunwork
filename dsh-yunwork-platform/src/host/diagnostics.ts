/**
 * A read-only answer to "is this plugin wired into the Profile the application actually runs".
 *
 * Every fact here is read from a service rather than derived: the contract comes from the generated file, the profile
 * directory from the launcher's own `profileContext`, the credential from the credentials store, the routes from the
 * settings forms. That is the point — a diagnosis that assembled paths itself would confirm its own arithmetic instead
 * of the application's, and the case it has to settle is precisely whether the data directory the installer wrote into
 * is the one the application reads.
 */
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { RUNTIME_VERSION, readRuntimeContract, type YunworkConfig } from './env-config.ts'
import { PI_AI_ENTRY, ROUTE_ID, isYunworkRoute } from './models.ts'

/** The record that carries the account, which is what "signed in" means to a diagnosis. */
const GRANT_RECORD = credentialKey('yunwork', 'grant')

/**
 * The profile facts the launcher supplies (`ProfileContext` in `@deepseek-ai/dsh-app-boot`). Read structurally: that
 * package is the launcher's, not this plugin's, and importing its type would tie the plugin to a package it never
 * receives at runtime.
 */
export interface ProfileFacts {
  readonly name: string
  readonly dir: string
  readonly patchPath: string
  readonly home: string
}

/**
 * Read the launcher's profile facts.
 * @param ctx - a context in the launched application, which carries them only when `dsh` launched it.
 * @returns the facts, or undefined outside a launched profile.
 */
export function profileFacts (ctx: object): ProfileFacts | undefined {
  const value = (ctx as { profileContext?: Partial<ProfileFacts> }).profileContext
  if (value === undefined || typeof value.dir !== 'string' || typeof value.home !== 'string') return undefined
  return {
    name: typeof value.name === 'string' ? value.name : '',
    dir: value.dir,
    patchPath: typeof value.patchPath === 'string' ? value.patchPath : '',
    home: value.home,
  }
}

/** Everything a diagnosis reports; every field says "unknown" rather than guessing. */
export interface DiagnosticsReport {
  readonly contract: {
    /** Absolute path of the generated runtime file, or null when the process names none. */
    readonly source: string | null
    readonly present: boolean
    readonly version: number | null
    /** The version this build reads. */
    readonly expectedVersion: number
    readonly env: string | null
    /** True when the file exists but this build cannot read that generation. */
    readonly incompatible: boolean
  }
  readonly profile: {
    /** Null outside a launched profile; also null rather than assembled, which is the whole point. */
    readonly dir: string | null
    readonly name: string | null
    readonly patchPath: string | null
    readonly home: string | null
  }
  readonly credential: {
    readonly key: string
    readonly present: boolean
    readonly kind?: string
    readonly writable?: boolean
  }
  readonly models: {
    readonly revision: number | null
    readonly hasYunworkProvider: boolean
    readonly route: string
  }
}

function modelsFacts (settings: SettingsForms): DiagnosticsReport['models'] {
  const entry = settings.describe({ redactSecrets: true }).find(item => item.ns === PI_AI_ENTRY)
  const providers = ((entry?.user ?? entry?.value) as { providers?: Record<string, { apiKeyEnv?: unknown }> } | undefined)?.providers ?? {}
  return {
    revision: typeof entry?.revision === 'number' ? entry.revision : null,
    hasYunworkProvider: isYunworkRoute(ROUTE_ID, providers[ROUTE_ID]),
    route: ROUTE_ID,
  }
}

/**
 * Gather one diagnosis.
 * @param options.ctx - the launched context, for the profile facts.
 * @param options.credentials - the credentials store, for whether the account is there.
 * @param options.settings - the settings forms, for the route and its revision.
 * @param options.config - the resolved deployment, when it resolved; its `env` is reported when present.
 * @param options.environment - the process environment naming the contract, default the real one.
 */
export async function collectDiagnostics (options: {
  ctx: object
  credentials: CredentialProvider
  settings: SettingsForms
  config?: YunworkConfig
  environment?: NodeJS.ProcessEnv
}): Promise<DiagnosticsReport> {
  const source = readRuntimeContract(options.environment ?? process.env)
  const facts = profileFacts(options.ctx)
  let credential: DiagnosticsReport['credential'] = { key: 'yunwork/grant', present: false }
  try {
    const described = await options.credentials.describeRecord(GRANT_RECORD)
    credential = {
      key: 'yunwork/grant',
      present: described.configured,
      ...(described.kind === undefined ? {} : { kind: described.kind }),
      writable: described.writable,
    }
  } catch {
    // A store that cannot answer leaves the field at "not present", never at a guess.
  }
  return {
    contract: {
      source: source.path,
      present: source.present,
      version: source.version,
      expectedVersion: RUNTIME_VERSION,
      env: options.config?.env ?? (typeof (source.value as { env?: unknown } | undefined)?.env === 'string' ? (source.value as { env: string }).env : null),
      incompatible: source.present && source.version !== RUNTIME_VERSION,
    },
    profile: {
      dir: facts?.dir ?? null,
      name: facts === undefined ? null : facts.name,
      patchPath: facts === undefined ? null : facts.patchPath,
      home: facts?.home ?? null,
    },
    credential,
    models: modelsFacts(options.settings),
  }
}
