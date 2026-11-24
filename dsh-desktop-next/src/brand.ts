/**
 * Resolve the brand this launch runs as, from the runtime contract beside the application.
 *
 * The contract is `yunwork-runtime.json`, written by `yunwork-shell/scripts/prepare-brand.mjs` and shipped as an extra
 * resource; the account plugin reads the same file, through the same three probes, so a packaged build names itself the
 * same way in both places.
 *
 * The last resort is the upstream identity rather than an error: a build without a contract is a build that was not
 * branded, and it should look exactly like the upstream Desktop instead of refusing to start. Only an explicitly
 * requested contract may fail loudly, because there the reader asked for a file and a missing one is a packaging
 * mistake worth stopping for.
 *
 * This module is the only brand reader that touches the file system, so only the main process may import it. A
 * renderer takes the same values from `DesktopState.brand`, which costs no Node and cannot break a sandboxed bundle.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { UPSTREAM_BRAND, type Brand } from './brand-defaults.ts'

export type { Brand } from './brand-defaults.ts'
export { UPSTREAM_BRAND } from './brand-defaults.ts'

const RUNTIME_FILENAME = 'yunwork-runtime.json'

/** The contract the environment names, which must exist: a path was chosen and the file is missing. */
function explicitRuntime(): string | undefined {
  const value = process.env.YUNWORK_RUNTIME
  if (value === undefined || value === '') return undefined
  if (!existsSync(value)) throw new Error(`YUNWORK_RUNTIME names ${value}, which does not exist`)
  return value
}

/**
 * The contract shipped with the application: inside the application archive of a branded build, beside the executable
 * in a packaged one, and beside `resourcesPath` where Electron provides it. All are probes, so none existing is an
 * error — the environment variable above is the only path that may fail loudly.
 */
function shippedRuntime(): string | undefined {
  // Electron adds `resourcesPath` to `process`, but only its own types say so and the packaging type check has none.
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath
  const candidates = [resourcesPath === undefined ? undefined : join(resourcesPath, RUNTIME_FILENAME),
    // A branded build carries the contract in the payload, and Electron reads an archive like a directory.
    resourcesPath === undefined ? undefined : join(resourcesPath, 'app.asar', RUNTIME_FILENAME),
    join(dirname(process.execPath), 'resources', RUNTIME_FILENAME)]
  return candidates.find(candidate => candidate !== undefined && existsSync(candidate))
}

/** Read one key, keeping only a usable value: anything else falls back per key rather than as a whole. */
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() !== '' ? value : undefined }

/** The file the resolution read, kept so the main process can name it to the Host, which cannot read an archive. */
let resolvedPath: string | undefined

function resolve(): Brand {
  const requested = explicitRuntime()
  const path = requested ?? shippedRuntime()
  if (path === undefined) return UPSTREAM_BRAND
  let contract: unknown
  try {
    contract = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (requested !== undefined) throw error
    return UPSTREAM_BRAND
  }
  resolvedPath = path
  const record = (contract ?? {}) as Record<string, unknown>
  const feed = record.updateFeedUrl
  return {
    productName: text(record.productName) ?? UPSTREAM_BRAND.productName,
    appId: text(record.appId) ?? UPSTREAM_BRAND.appId,
    dataDirName: text(record.dataDirName) ?? UPSTREAM_BRAND.dataDirName,
    // `null` is a decision — this build does not update itself — so only a non-empty string replaces it.
    updateFeedUrl: text(feed) ?? (feed === null ? null : UPSTREAM_BRAND.updateFeedUrl),
  }
}

/** The brand of this launch, resolved once: the contract cannot change while the application runs. */
export const brand: Brand = resolve()

/**
 * The contract this launch read, or `undefined` when it found none.
 *
 * The Host is a separate process and cannot read inside the application archive, so the main process hands this path to
 * it through `YUNWORK_RUNTIME`; that is the only reason the path outlives the resolution.
 */
export const contractPath: string | undefined = resolvedPath
