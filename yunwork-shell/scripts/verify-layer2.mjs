/**
 * Hold the second layer to what `LAYER2-CHANGES.md` registers.
 *
 * The desktop base is upstream code we must be able to sync from, so every line we change there is a future conflict.
 * This script turns the registry into something a machine can check: the files we may touch, how many lines each one
 * may add and remove, the only places a brand literal may survive, and the one assertion whose failure is not cosmetic
 * — a renderer or preload bundle that pulls in Node cannot load inside the sandbox.
 *
 * The counts are exact, not ceilings: a diff smaller than the registered one means someone edited a line we did not
 * register, and the registry has to say so before it can be trusted. Changing the second layer therefore means editing
 * this table and the document in the same commit, which is the whole point.
 *
 * Usage: `node yunwork-shell/scripts/verify-layer2.mjs [--base <commit>]`
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHELL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPOSITORY_ROOT = resolve(SHELL_ROOT, '..')

/** The commit the second layer started from: the last tree that was still pure upstream in `dsh-desktop-next`. */
const DEFAULT_BASE = 'master'

/** Every file this layer may touch, with the exact `git diff --numstat` it is registered for. */
const QUOTA = {
  "dsh-desktop-next/cordis.patch.yml": { added: 25, removed: 0 },
  "dsh-desktop-next/package.json": { added: 3, removed: 1 },
  "dsh-desktop-next/scripts/package.ts": { added: 49, removed: 2 },
  "dsh-desktop-next/scripts/packaged-payload.ts": { added: 1, removed: 1 },
  "dsh-desktop-next/scripts/prepare-payload.ts": { added: 14, removed: 1 },
  "dsh-desktop-next/scripts/verify-fuses.ts": { added: 5, removed: 4 },
  "dsh-desktop-next/scripts/verify-packaged.ts": { added: 4, removed: 3 },
  "dsh-desktop-next/scripts/verify-win-installer.ts": { added: 17, removed: 10 },
  "dsh-desktop-next/src/app-downloads.ts": { added: 2, removed: 1 },
  "dsh-desktop-next/src/brand-defaults.ts": { added: 39, removed: 0 },
  "dsh-desktop-next/src/brand.ts": { added: 86, removed: 0 },
  "dsh-desktop-next/src/client/app-icon-setting.tsx": { added: 3, removed: 1 },
  "dsh-desktop-next/src/client/desktop-settings/market-options.tsx": { added: 0, removed: 3 },
  "dsh-desktop-next/src/client/onboarding.tsx": { added: 3, removed: 3 },
  "dsh-desktop-next/src/client/plugin-controls.tsx": { added: 3, removed: 3 },
  "dsh-desktop-next/src/client/settings.tsx": { added: 10, removed: 4 },
  "dsh-desktop-next/src/client/updates.tsx": { added: 13, removed: 5 },
  "dsh-desktop-next/src/data-directory.ts": { added: 15, removed: 5 },
  "dsh-desktop-next/src/desktop-contract.ts": { added: 6, removed: 0 },
  "dsh-desktop-next/src/desktop-menu.ts": { added: 2, removed: 1 },
  "dsh-desktop-next/src/desktop-terminal/mac-scripts.ts": { added: 2, removed: 2 },
  "dsh-desktop-next/src/desktop-terminal/windows-scripts.ts": { added: 4, removed: 4 },
  "dsh-desktop-next/src/desktop-terminal/windows-shell.ts": { added: 6, removed: 1 },
  "dsh-desktop-next/src/failure-report.ts": { added: 2, removed: 1 },
  "dsh-desktop-next/src/host-startup-limit.ts": { added: 9, removed: 4 },
  "dsh-desktop-next/src/main-window-state.ts": { added: 1, removed: 1 },
  "dsh-desktop-next/src/main.ts": { added: 47, removed: 20 },
  "dsh-desktop-next/src/menu-locale.ts": { added: 3, removed: 2 },
  "dsh-desktop-next/src/native-desktop.ts": { added: 6, removed: 5 },
  "dsh-desktop-next/src/native-ui/index.html": { added: 1, removed: 1 },
  "dsh-desktop-next/src/native-ui/main.tsx": { added: 5, removed: 2 },
  "dsh-desktop-next/src/native-ui/onboarding.tsx": { added: 32, removed: 16 },
  "dsh-desktop-next/src/notifications.ts": { added: 3, removed: 2 },
  "dsh-desktop-next/src/program-directory.ts": { added: 7, removed: 6 },
  "dsh-desktop-next/src/runtime-tree.ts": { added: 2, removed: 1 },
  "dsh-desktop-next/src/sandbox-launch.ts": { added: 19, removed: 18 },
  "dsh-desktop-next/src/update-installer.ts": { added: 10, removed: 7 },
  "dsh-desktop-next/src/update-state.ts": { added: 6, removed: 0 },
  "dsh-desktop-next/src/updates.ts": { added: 64, removed: 13 },
  "dsh-desktop-next/src/yunwork-updates.ts": { added: 249, removed: 0 },
  "dsh-desktop-next/tests/yunwork-updates.spec.ts": { added: 244, removed: 0 },
  "yarn.lock": { added: 33, removed: 1 },
}

/** The prebuilt plugin tarball is registered by name alone: it has bytes, not line counts. */
const BINARY_ALLOWANCE = new Set([
  'vendor/yundashi/yundashi-dsh-yunwork-platform-0.1.0-desktop.2a01f848dfc2.tgz',
  'vendor/yundashi/agents-anywhere-dsh-bridge-next-2.2.1-desktop.cefb8a7c734fa.r08887e32.tgz',
])

/** Paths this layer owns: everything else in the diff belongs to the third layer or to upstream. */
const isLayer2 = file => file.startsWith('dsh-desktop-next/') || file === 'yarn.lock' || (file.startsWith('vendor/yundashi/') && file.endsWith('.tgz'))

const LITERAL_ALLOWANCE = {
  // The single source of the upstream identity; every fallback in this layer reads it.
  'dsh-desktop-next/src/brand-defaults.ts': 1,
  // The comment that explains the upstream application-data name; no code uses the literal.
  'dsh-desktop-next/src/data-directory.ts': 1,
}

/** Bundles that run without Node: `require('node:fs')` in one of them fails the whole renderer. */
const SANDBOXED_BUNDLES = ['lib/client.js', 'lib/preload-app.cjs', 'lib/preload-shell.cjs', 'lib/preload-platform-account.cjs']

const failures = []
const fail = message => { failures.push(message) }

function git (...args) {
  return execFileSync('git', args, { cwd: REPOSITORY_ROOT, encoding: 'utf8' })
}

const baseIndex = process.argv.indexOf('--base')
const base = baseIndex === -1 ? DEFAULT_BASE : process.argv[baseIndex + 1]

/** One pass over the whole diff: every file this layer touched, with its real line counts. */
const numstat = new Map()
for (const line of git('diff', '--numstat', `${base}`).split('\n')) {
  if (line.trim() === '') continue
  const [added, removed, file] = line.split('\t')
  // A binary file (the vendor tarball) reports `-` for both counts; it is registered by name only.
  numstat.set(file, { added: added === '-' ? 0 : Number(added), removed: removed === '-' ? 0 : Number(removed), binary: added === '-' })
}
for (const file of git('ls-files', '--others', '--exclude-standard', '--', 'dsh-desktop-next/', 'vendor/yundashi/').split('\n')) {
  const trimmed = file.trim()
  if (trimmed === '' || numstat.has(trimmed)) continue
  const lines = readFileSync(join(REPOSITORY_ROOT, trimmed), 'utf8').split('\n').length - 1
  numstat.set(trimmed, { added: lines, removed: 0, binary: false })
}

for (const [file, counts] of numstat) {
  if (!isLayer2(file)) continue
  if (counts.binary) {
    if (!BINARY_ALLOWANCE.has(file)) fail(`${file}: 未登记的二进制改动`)
    continue
  }
  const registered = QUOTA[file]
  if (registered === undefined) { fail(`${file}: 未登记的第 2 层改动（实际 +${counts.added}/−${counts.removed}）`); continue }
  if (counts.added !== registered.added || counts.removed !== registered.removed) {
    fail(`${file}: 实际 +${counts.added}/−${counts.removed}，登记为 +${registered.added}/−${registered.removed}`)
  }
}
for (const file of Object.keys(QUOTA)) {
  if (!numstat.has(file)) fail(`${file}: 登记在册但当前 diff 里没有它（被还原了？）`)
}
for (const file of BINARY_ALLOWANCE) {
  if (!numstat.has(file)) fail(`${file}: 登记在册但当前 diff 里没有它（被删了？）`)
}

/** Every remaining brand literal, counted per file. */
const literalCounts = new Map()
function scan (directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { scan(path); continue }
    if (!/\.(ts|tsx|html)$/u.test(entry.name)) continue
    const text = readFileSync(path, 'utf8')
    const count = text.split('DSH NEXT').length - 1
    if (count > 0) literalCounts.set(path.slice(REPOSITORY_ROOT.length + 1).replaceAll('\\', '/'), count)
  }
}
scan(join(REPOSITORY_ROOT, 'dsh-desktop-next', 'src'))
for (const [file, count] of literalCounts) {
  const allowed = LITERAL_ALLOWANCE[file] ?? 0
  if (count !== allowed) fail(`${file}: 品牌字面量 ${count} 处，登记 ${allowed} 处`)
}
for (const file of Object.keys(LITERAL_ALLOWANCE)) {
  if (!literalCounts.has(file)) fail(`${file}: 登记有品牌字面量，实际已清零（登记过期）`)
}

/** The bundles, when the desktop was built: a Node import here breaks the sandbox, not just a page. */
for (const bundle of SANDBOXED_BUNDLES) {
  const path = join(REPOSITORY_ROOT, 'dsh-desktop-next', bundle)
  if (!existsSync(path)) continue
  if (readFileSync(path, 'utf8').includes('node:fs')) fail(`${bundle}: 含 node:fs，沙箱内加载会失败`)
}
const nativeUi = join(REPOSITORY_ROOT, 'dsh-desktop-next', 'lib', 'native-ui')
if (existsSync(nativeUi)) {
  for (const entry of readdirSync(nativeUi, { recursive: true })) {
    const name = String(entry)
    if (!name.endsWith('.js')) continue
    if (readFileSync(join(nativeUi, name), 'utf8').includes('node:fs')) fail(`lib/native-ui/${name}: 含 node:fs，沙箱内加载会失败`)
  }
}

if (failures.length > 0) {
  console.error(`第 2 层越界：${failures.length} 项与 LAYER2-CHANGES.md 登记不符`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exitCode = 1
} else {
  console.log(`第 2 层符合登记：${Object.keys(QUOTA).length} 个文件、${Object.values(QUOTA).reduce((sum, q) => sum + q.added, 0)} 行新增、`
    + `${Object.values(QUOTA).reduce((sum, q) => sum + q.removed, 0)} 行删除，品牌字面量只在 ${Object.keys(LITERAL_ALLOWANCE).length} 处。`)
}
