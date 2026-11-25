import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface YunworkMarketContract {
  readonly manifestUrl?: string
  readonly insecureOrigin?: string
  readonly displayName: string
}

function readRuntimeContract(): Record<string, unknown> | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    process.env['YUNWORK_RUNTIME'],
    typeof resourcesPath === 'string' ? join(resourcesPath, 'yunwork-runtime.json') : undefined,
    typeof resourcesPath === 'string' ? join(resourcesPath, 'app.asar.unpacked', 'yunwork-runtime.json') : undefined,
    join(dirname(process.execPath), 'resources', 'yunwork-runtime.json'),
  ].filter((p): p is string => typeof p === 'string' && p.trim() !== '')

  for (const file of candidates) {
    if (!existsSync(file)) continue
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as Record<string, unknown>
      }
    } catch {
      // Ignore unreadable candidate and continue probing.
    }
  }
  return undefined
}

export function probeYunworkMarketContract(): YunworkMarketContract {
  const parsed = readRuntimeContract()
  const envManifest = process.env['YUNWORK_MARKET_MANIFEST_URL']?.trim()
  const serverUrl = typeof parsed?.['anywhereServerUrl'] === 'string' ? parsed['anywhereServerUrl'].trim() : ''
  const manifestUrl = envManifest
    || (serverUrl !== '' ? `${serverUrl.replace(/\/+$/u, '')}/api/v2/plugins/config` : undefined)

  let insecureOrigin: string | undefined
  if (parsed?.['insecure'] === true && manifestUrl !== undefined) {
    try {
      const url = new URL(manifestUrl)
      if (url.protocol === 'http:') {
        insecureOrigin = url.origin
      }
    } catch {
      insecureOrigin = undefined
    }
  }

  const shortName = typeof parsed?.['shortName'] === 'string' ? parsed['shortName'].trim() : ''
  const productName = typeof parsed?.['productName'] === 'string' ? parsed['productName'].trim() : ''
  return {
    ...(manifestUrl !== undefined ? { manifestUrl } : {}),
    ...(insecureOrigin !== undefined ? { insecureOrigin } : {}),
    displayName: shortName || productName || '云大师',
  }
}
