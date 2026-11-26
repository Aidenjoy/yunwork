/** Custom Yunwork desktop release check and installer download against `<updateFeedUrl>?type=...`. */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { compareSemVerVersions, parseSemVer, type UpdateRequest } from '../../dsh-plugin-desktop/src/update-checker.ts'
import { MAX_UPDATE_DOWNLOAD_BYTES, UpdateDownloadError, type DesktopDownloadPlatform, type UpdateArtifactRequest } from '../../dsh-plugin-desktop/src/update-download.ts'

export interface YunworkReleaseItem {
  readonly platform?: string
  readonly version: string
  readonly downloadUrl: string
  readonly fileName?: string
  readonly notes?: string
  readonly publishedAt?: string
  readonly type?: string
  readonly sha256?: string
}

export interface YunworkUpdateCheckResult {
  readonly status: 'up-to-date' | 'update-available'
  readonly currentVersion: string
  readonly latestVersion: string
  readonly downloadUrl?: string
  readonly fileName?: string
  readonly notes?: string
  readonly publishedAt?: string
  readonly sha256?: string
}

const MAX_RELEASE_RESPONSE_BYTES = 64 * 1024
const SHA256_HEX = /^[0-9a-f]{64}$/iu

export function yunworkReleaseType(platform: string, arch: 'x64' | 'arm64' = process.arch === 'arm64' ? 'arm64' : 'x64'): string | undefined {
  if (platform === 'win32') return 'desktop-windows'
  if (platform === 'darwin') return arch === 'arm64' ? 'desktop-macos-arm64' : 'desktop-macos-x64'
  return undefined
}

export function normalizeYunworkVersion(version: string): string {
  const trimmed = version.trim().replace(/^v/u, '').replace(/-next$/u, '')
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(trimmed)) return trimmed.split('.').slice(0, 3).join('.')
  return trimmed
}

export function sameYunworkVersion(left: string, right: string): boolean {
  return normalizeYunworkVersion(left) === normalizeYunworkVersion(right)
}

export function yunworkUpdateFilename(platform: DesktopDownloadPlatform, version: string, arch: 'x64' | 'arm64'): string {
  return `yunwork-${normalizeYunworkVersion(version)}-${arch}.${platform === 'win32' ? 'exe' : 'dmg'}`
}

function isAllowedUrl(raw: string, allowHttp: boolean): boolean {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol === 'https:') return true
    return allowHttp && parsed.protocol === 'http:'
  } catch {
    return false
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Yunwork release response exceeded size limit')
    return text
  }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value || value.byteLength === 0) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error('Yunwork release response exceeded size limit')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

export async function checkYunworkUpdate(options: {
  readonly feedUrl: string
  readonly currentVersion: string
  readonly platform: string
  readonly arch?: 'x64' | 'arm64'
  readonly request: UpdateRequest
  readonly signal?: AbortSignal
}): Promise<YunworkUpdateCheckResult> {
  const releaseType = yunworkReleaseType(options.platform, options.arch)
  if (!releaseType) {
    return { status: 'up-to-date', currentVersion: options.currentVersion, latestVersion: options.currentVersion }
  }
  const url = new URL(options.feedUrl)
  url.searchParams.set('type', releaseType)
  const allowHttp = url.protocol === 'http:'
  const response = await options.request(url.href, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'error',
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!response.ok) {
    throw new Error(`Yunwork release check failed with HTTP ${String(response.status)}`)
  }
  const text = await readBoundedText(response, MAX_RELEASE_RESPONSE_BYTES)
  const body = JSON.parse(text) as { items?: unknown }
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
    throw new Error('Yunwork release response missing items array')
  }
  const items = body.items as YunworkReleaseItem[]
  const item = items.find(entry => entry && (entry.type === releaseType || entry.platform === releaseType))
  if (!item) {
    return { status: 'up-to-date', currentVersion: options.currentVersion, latestVersion: options.currentVersion }
  }
  if (typeof item.version !== 'string' || typeof item.downloadUrl !== 'string') {
    throw new Error('Yunwork release item missing version or downloadUrl')
  }
  const normalizedLatest = normalizeYunworkVersion(item.version)
  const normalizedCurrent = normalizeYunworkVersion(options.currentVersion)
  if (parseSemVer(normalizedLatest) === null || parseSemVer(normalizedCurrent) === null) {
    throw new Error(`Invalid SemVer in Yunwork release: ${item.version}`)
  }
  if (!isAllowedUrl(item.downloadUrl, allowHttp)) {
    throw new Error(`Disallowed downloadUrl protocol: ${item.downloadUrl}`)
  }
  if (item.sha256 !== undefined && !SHA256_HEX.test(item.sha256)) {
    throw new Error(`Invalid sha256 digest in Yunwork release: ${item.sha256}`)
  }
  const cmp = compareSemVerVersions(normalizedLatest, normalizedCurrent)
  if (cmp === null) {
    throw new Error(`Unable to compare versions ${normalizedLatest} and ${normalizedCurrent}`)
  }
  return {
    status: cmp > 0 ? 'update-available' : 'up-to-date',
    currentVersion: options.currentVersion,
    latestVersion: item.version,
    downloadUrl: item.downloadUrl,
    ...(typeof item.fileName === 'string' ? { fileName: item.fileName } : {}),
    ...(typeof item.notes === 'string' ? { notes: item.notes } : {}),
    ...(typeof item.publishedAt === 'string' ? { publishedAt: item.publishedAt } : {}),
    ...(typeof item.sha256 === 'string' ? { sha256: item.sha256.toLowerCase() } : {}),
  }
}

async function assertBinaryFormat(filePath: string, platform: DesktopDownloadPlatform): Promise<void> {
  const handle = await open(filePath, 'r')
  try {
    const stat = await handle.stat()
    if (platform === 'win32') {
      if (stat.size < 64) throw new UpdateDownloadError('invalid-artifact', 'Windows installer is too small')
      const dos = Buffer.alloc(64)
      await handle.read(dos, 0, 64, 0)
      if (dos[0] !== 0x4d || dos[1] !== 0x5a) throw new UpdateDownloadError('invalid-artifact', 'Windows installer missing MZ header')
      const peOffset = dos.readUInt32LE(0x3c)
      if (peOffset + 4 > stat.size) throw new UpdateDownloadError('invalid-artifact', 'Windows installer has invalid PE offset')
      const pe = Buffer.alloc(4)
      await handle.read(pe, 0, 4, peOffset)
      if (!pe.equals(Buffer.from([0x50, 0x45, 0x00, 0x00]))) throw new UpdateDownloadError('invalid-artifact', 'Windows installer missing PE signature')
    } else {
      if (stat.size < 512) throw new UpdateDownloadError('invalid-artifact', 'macOS disk image is too small')
      const trailer = Buffer.alloc(512)
      await handle.read(trailer, 0, 512, stat.size - 512)
      if (!trailer.subarray(0, 4).equals(Buffer.from('koly', 'ascii'))) {
        throw new UpdateDownloadError('invalid-artifact', 'macOS disk image missing koly trailer')
      }
    }
  } finally {
    await handle.close()
  }
}

export async function downloadYunworkUpdate(options: {
  readonly downloadUrl: string
  readonly platform: DesktopDownloadPlatform
  readonly destinationPath: string
  readonly request: UpdateArtifactRequest
  readonly expectedSha256?: string
  readonly allowHttp?: boolean
  readonly signal?: AbortSignal
  readonly onProgress?: (received: number, total: number | undefined) => void
}): Promise<string> {
  const allowHttp = options.allowHttp === true
  const { response, finalUrl } = await options.request(options.downloadUrl, {
    method: 'GET',
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!response.ok) {
    throw new UpdateDownloadError('http-status', `Update download failed with HTTP ${String(response.status)}`, { status: response.status })
  }
  if (!isAllowedUrl(finalUrl || options.downloadUrl, allowHttp)) {
    throw new UpdateDownloadError('redirect-origin', `Disallowed redirect target: ${finalUrl}`)
  }
  if (!response.body) {
    throw new UpdateDownloadError('empty-body', 'Update download returned an empty body')
  }
  const contentLength = response.headers.get('content-length')
  const total = contentLength && /^\d+$/.test(contentLength) ? Number(contentLength) : undefined
  if (total !== undefined && total > MAX_UPDATE_DOWNLOAD_BYTES) {
    throw new UpdateDownloadError('response-too-large', 'Update installer exceeds maximum size')
  }
  await mkdir(dirname(options.destinationPath), { recursive: true, mode: 0o700 })
  const tempPath = join(dirname(options.destinationPath), `.tmp-${randomUUID()}`)
  const reader = response.body.getReader()
  const writer = createWriteStream(tempPath, { mode: 0o600 })
  const hash = createHash('sha256')
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      received += value.byteLength
      if (received > MAX_UPDATE_DOWNLOAD_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new UpdateDownloadError('response-too-large', 'Update installer exceeds maximum size')
      }
      hash.update(value)
      await new Promise<void>((resolve, reject) => {
        writer.write(value, error => (error ? reject(error) : resolve()))
      })
      options.onProgress?.(received, total)
    }
    await new Promise<void>((resolve, reject) => {
      writer.end((error?: Error | null) => (error ? reject(error) : resolve()))
    })
    const stat = await lstat(tempPath)
    if (stat.size === 0) throw new UpdateDownloadError('empty-body', 'Downloaded installer is empty')
    if (options.expectedSha256 !== undefined) {
      const actual = hash.digest()
      const expected = Buffer.from(options.expectedSha256, 'hex')
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new UpdateDownloadError('invalid-artifact', 'Downloaded installer SHA-256 mismatch')
      }
    }
    await assertBinaryFormat(tempPath, options.platform)
    await rename(tempPath, options.destinationPath)
    return options.destinationPath
  } catch (error) {
    writer.destroy()
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}
