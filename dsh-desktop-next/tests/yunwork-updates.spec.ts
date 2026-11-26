import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { NextUpdates } from '../src/updates.ts'
import { checkYunworkUpdate, downloadYunworkUpdate, normalizeYunworkVersion, sameYunworkVersion, yunworkReleaseType, yunworkUpdateFilename } from '../src/yunwork-updates.ts'

function fakePeBuffer(): Buffer {
  const buf = Buffer.alloc(128)
  buf[0] = 0x4d
  buf[1] = 0x5a
  buf.writeUInt32LE(0x40, 0x3c)
  buf.write('PE\0\0', 0x40, 'ascii')
  return buf
}

describe('yunwork-updates', () => {
  it('maps platform and arch to release type', () => {
    assert.equal(yunworkReleaseType('win32', 'x64'), 'desktop-windows')
    assert.equal(yunworkReleaseType('darwin', 'arm64'), 'desktop-macos-arm64')
    assert.equal(yunworkReleaseType('darwin', 'x64'), 'desktop-macos-x64')
    assert.equal(yunworkReleaseType('linux', 'x64'), undefined)
  })

  it('normalizes -next and 4-part Windows versions', () => {
    assert.equal(normalizeYunworkVersion('2.0.25-next'), '2.0.25')
    assert.equal(normalizeYunworkVersion('v2.0.25.0'), '2.0.25')
    assert.equal(normalizeYunworkVersion('2.0.26.1234'), '2.0.26')
    assert.equal(sameYunworkVersion('2.0.25-next', '2.0.25'), true)
    assert.equal(sameYunworkVersion('2.0.26.1234', '2.0.26'), true)
    assert.equal(sameYunworkVersion('2.0.26', '2.0.25'), false)
  })

  it('generates yunworkUpdateFilename without next prerelease constraint', () => {
    assert.equal(yunworkUpdateFilename('win32', '2.0.26', 'x64'), 'yunwork-2.0.26-x64.exe')
    assert.equal(yunworkUpdateFilename('darwin', '2.0.26', 'arm64'), 'yunwork-2.0.26-arm64.dmg')
  })

  it('returns up-to-date when items array is empty or has no matching platform', async () => {
    const empty = await checkYunworkUpdate({
      feedUrl: 'https://agent.yundashi.com/api/v2/releases/latest',
      currentVersion: '2.0.25-next',
      platform: 'darwin',
      arch: 'arm64',
      request: async () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    })
    assert.equal(empty.status, 'up-to-date')

    const mismatched = await checkYunworkUpdate({
      feedUrl: 'https://agent.yundashi.com/api/v2/releases/latest',
      currentVersion: '2.0.25-next',
      platform: 'darwin',
      arch: 'x64',
      request: async () => new Response(JSON.stringify({
        items: [{ version: '2.0.99', downloadUrl: 'https://example.com/android.apk', type: 'android', platform: 'android' }],
      }), { status: 200 }),
    })
    assert.equal(mismatched.status, 'up-to-date')
  })

  it('treats 2.0.25 vs 2.0.25-next as up-to-date and 2.0.26 as update-available', async () => {
    const payload = (version: string) => JSON.stringify({
      items: [{
        platform: 'desktop-windows',
        version,
        downloadUrl: 'https://rental-machine.oss-cn-beijing.aliyuncs.com/yunagent/yundashi-agent-Setup.exe',
        fileName: '客户端win',
        notes: '修复若干问题',
        type: 'desktop-windows',
      }],
    })

    const same = await checkYunworkUpdate({
      feedUrl: 'https://agent.yundashi.com/api/v2/releases/latest',
      currentVersion: '2.0.25-next',
      platform: 'win32',
      request: async () => new Response(payload('2.0.25'), { status: 200 }),
    })
    assert.equal(same.status, 'up-to-date')

    const newer = await checkYunworkUpdate({
      feedUrl: 'https://agent.yundashi.com/api/v2/releases/latest',
      currentVersion: '2.0.25-next',
      platform: 'win32',
      request: async (url) => {
        assert.equal(url, 'https://agent.yundashi.com/api/v2/releases/latest?type=desktop-windows')
        return new Response(payload('2.0.26'), { status: 200 })
      },
    })
    assert.equal(newer.status, 'update-available')
    assert.equal(newer.latestVersion, '2.0.26')
    assert.equal(newer.notes, '修复若干问题')
  })

  it('rejects http downloadUrl when feedUrl is https, missing downloadUrl, and oversized responses', async () => {
    await assert.rejects(
      () => checkYunworkUpdate({
        feedUrl: 'https://agent.yundashi.com/api/v2/releases/latest',
        currentVersion: '2.0.25-next',
        platform: 'win32',
        request: async () => new Response(JSON.stringify({
          items: [{ version: '2.0.26', downloadUrl: 'http://insecure.example.com/app.exe', type: 'desktop-windows' }],
        }), { status: 200 }),
      }),
      /Disallowed downloadUrl protocol/,
    )

    await assert.rejects(
      () => checkYunworkUpdate({
        feedUrl: 'https://agent.yundashi.com/api/v2/releases/latest',
        currentVersion: '2.0.25-next',
        platform: 'win32',
        request: async () => new Response(JSON.stringify({
          items: [{ version: '2.0.26', type: 'desktop-windows' }],
        }), { status: 200 }),
      }),
      /missing version or downloadUrl/,
    )

    await assert.rejects(
      () => checkYunworkUpdate({
        feedUrl: 'https://agent.yundashi.com/api/v2/releases/latest',
        currentVersion: '2.0.25-next',
        platform: 'win32',
        request: async () => new Response('x'.repeat(70 * 1024), { status: 200 }),
      }),
      /exceeded size limit/,
    )
  })

  it('downloads PE installer, verifies sha256, and rejects invalid magic or digest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'yunwork-dl-'))
    try {
      const pe = fakePeBuffer()
      const sha256 = createHash('sha256').update(pe).digest('hex')
      const dest = join(dir, 'update.exe')
      const downloaded = await downloadYunworkUpdate({
        downloadUrl: 'https://cdn.example.com/app.exe',
        platform: 'win32',
        destinationPath: dest,
        expectedSha256: sha256,
        request: async (url) => ({ response: new Response(new Uint8Array(pe), { status: 200 }), finalUrl: url }),
      })
      assert.equal(downloaded, dest)

      await assert.rejects(
        () => downloadYunworkUpdate({
          downloadUrl: 'https://cdn.example.com/app.exe',
          platform: 'win32',
          destinationPath: join(dir, 'bad-sha.exe'),
          expectedSha256: '0'.repeat(64),
          request: async (url) => ({ response: new Response(new Uint8Array(pe), { status: 200 }), finalUrl: url }),
        }),
        /SHA-256 mismatch/,
      )

      await assert.rejects(
        () => downloadYunworkUpdate({
          downloadUrl: 'https://cdn.example.com/app.exe',
          platform: 'win32',
          destinationPath: join(dir, 'bad-pe.exe'),
          request: async (url) => ({ response: new Response(Buffer.alloc(128), { status: 200 }), finalUrl: url }),
        }),
        /missing MZ header/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('NextUpdates.download() succeeds with formal version 2.0.26 and clears stale notes on up-to-date', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'yunwork-upd-'))
    try {
      const pe = fakePeBuffer()
      let serverVersion = '2.0.26'
      let preparedVersion = ''
      const updates = new NextUpdates({
        version: '2.0.25-next',
        platform: 'win32',
        packaged: true,
        userData: dir,
        downloads: dir,
        arch: 'x64',
        feedUrl: 'https://agent.yundashi.com/api/v2/releases/latest',
        request: async () => new Response(JSON.stringify({
          items: [{
            version: serverVersion,
            downloadUrl: 'https://cdn.example.com/yundashi-Setup.exe',
            notes: serverVersion === '2.0.26' ? 'Release 2.0.26' : undefined,
            type: 'desktop-windows',
          }],
        }), { status: 200 }),
        artifactRequest: async (url) => ({ response: new Response(new Uint8Array(pe), { status: 200 }), finalUrl: url }),
        changed: () => {},
        log: (err) => { throw err instanceof Error ? err : new Error(String(err)) },
        prepare: async (_path, version) => { preparedVersion = version },
        install: async () => {},
      })

      await updates.download()
      assert.equal(preparedVersion, '2.0.26')
      assert.equal(updates.snapshot().phase, 'ready')

      serverVersion = '2.0.25'
      await updates.check()
      const snap = updates.snapshot()
      assert.equal(snap.phase, 'ready') // ready is preserved by check()

      const updates2 = new NextUpdates({
        version: '2.0.25-next',
        platform: 'win32',
        packaged: true,
        userData: dir,
        downloads: dir,
        arch: 'x64',
        feedUrl: 'https://agent.yundashi.com/api/v2/releases/latest',
        request: async () => new Response(JSON.stringify({
          items: [{
            version: serverVersion,
            downloadUrl: 'https://cdn.example.com/yundashi-Setup.exe',
            notes: serverVersion === '2.0.26' ? 'Release 2.0.26' : undefined,
            type: 'desktop-windows',
          }],
        }), { status: 200 }),
        artifactRequest: async (url) => ({ response: new Response(new Uint8Array(pe), { status: 200 }), finalUrl: url }),
        changed: () => {},
        log: () => {},
        prepare: async () => {},
        install: async () => {},
      })
      serverVersion = '2.0.26'
      await updates2.check()
      assert.equal(updates2.snapshot().notes, 'Release 2.0.26')
      serverVersion = '2.0.25'
      await updates2.check()
      assert.equal(updates2.snapshot().notes, undefined)
      assert.equal(updates2.snapshot().downloadUrl, undefined)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
