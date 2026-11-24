/**
 * Render the brand artwork into the icon files the desktop packages.
 *
 * The artwork lives in `yunwork-shell/assets/` and never in the base desktop: overwriting the base's binary assets would
 * put a conflict on every sync and would break the tests that hash them. Instead this script writes a parallel tree that
 * `run.mjs` lays over `dsh-desktop-next/` for the length of one packaging run and then removes.
 *
 * Everything here is derived from one PNG per platform plus the vector that Icon Composer renders on macOS, so a new
 * mark means replacing a source file rather than editing a generated one. `overlay.json` lists what to write and what to
 * remove, which is what makes the restore exact.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHELL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPOSITORY_ROOT = resolve(SHELL_ROOT, '..')
const DESKTOP_ROOT = join(REPOSITORY_ROOT, 'dsh-desktop-next')
const ASSET_DIRECTORY = join(SHELL_ROOT, 'assets')

/** Where `prepare-brand.mjs` leaves the contract, which carries the colour the tray mark is filled with. */
const DEFAULT_CONTRACT = join(SHELL_ROOT, '.yunwork-build', 'yunwork-runtime.json')
const DEFAULT_OUT = join(SHELL_ROOT, '.yunwork-build', 'icons')
const FALLBACK_COLOR = '#2D97D3'

/** Linux draws the icon at these sizes; the Windows container carries the rest of the small set. */
const LINUX_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512]
const ICO_SIZES = [16, 20, 24, 28, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256]
/** macOS container chunks, smallest first: PNG payloads are what every supported release reads. */
const ICNS_CHUNKS = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]

/** One PNG container holding every size Windows asks for, in the order Microsoft documents. */
function icoContainer (frames) {
  const directory = Buffer.alloc(6 + frames.length * 16)
  directory.writeUInt16LE(0, 0)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(frames.length, 4)
  let offset = directory.length
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16
    // 0 stands for 256 in this directory: the field is one byte wide.
    directory.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry)
    directory.writeUInt8(frame.size >= 256 ? 0 : frame.size, entry + 1)
    directory.writeUInt8(0, entry + 2)
    directory.writeUInt8(0, entry + 3)
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(frame.png.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += frame.png.length
  })
  return Buffer.concat([directory, ...frames.map(frame => frame.png)])
}

/** One ICNS container: a signature, a total length, then type/length/payload chunks. */
function icnsContainer (chunks) {
  const parts = chunks.map(([type, png]) => {
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const body = Buffer.concat(parts)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

/** Split `#rrggbb` into the three bytes a raw pixel needs. */
function rgb (color) {
  return [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16))
}

/**
 * Turn a rendered mark into a one-colour image that keeps only the artwork's shape.
 *
 * macOS renders `tray-iconTemplate*` as a mask, so the colour has to be black and the shape has to be the alpha; the
 * Windows copy keeps the brand colour.
 */
async function silhouette (sharp, source, size, color) {
  const { data, info } = await sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const [r, g, b] = rgb(color)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = r
    data[index + 1] = g
    data[index + 2] = b
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}

export async function exportIcons ({ out = DEFAULT_OUT, contract = DEFAULT_CONTRACT } = {}) {
  const sharp = createRequire(join(DESKTOP_ROOT, 'package.json'))('sharp')
  const brand = existsSync(contract) ? JSON.parse(readFileSync(contract, 'utf8')) : {}
  const color = typeof brand.brandColor === 'string' && /^#[0-9a-f]{6}$/iu.test(brand.brandColor) ? brand.brandColor : FALLBACK_COLOR
  const macSource = join(ASSET_DIRECTORY, 'icon-macos.png')
  const windowsSource = join(ASSET_DIRECTORY, 'icon-windows.png')
  const vector = readFileSync(join(ASSET_DIRECTORY, 'icon.svg'), 'utf8')

  const written = []
  const removed = []
  const write = (path, bytes) => {
    const destination = join(out, ...path.split('/'))
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, bytes)
    written.push(path)
  }
  const png = (source, size) => sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()

  for (const family of [{ prefix: '', source: macSource, vectorName: 'whale-cobalt.svg' },
    { prefix: 'classic/', source: windowsSource, vectorName: 'DeepSeek.svg' }]) {
    const base = family.prefix
    write(`build/${base}app-icon.png`, await png(windowsSource, 1024))
    write(`build/${base}app-icon-mac.png`, await png(macSource, 1024))
    write(`build/${base}app-icon-preview.png`, await png(windowsSource, 128))
    if (base === '') {
      // Windows and Linux show the Dark rendition while the system theme is dark; one artwork serves both variants.
      write('build/app-icon-dark.png', await png(windowsSource, 1024))
      write('build/app-icon-preview-dark.png', await png(windowsSource, 128))
    }
    write(`build/${base}app-icon.ico`, icoContainer(await Promise.all(ICO_SIZES.map(async size => ({ size, png: await png(windowsSource, size) })))))
    write(`build/${base}app-icon.icns`, icnsContainer(await Promise.all(ICNS_CHUNKS.map(async ([type, size]) => [type, await png(macSource, size)]))))
    // The bundle keeps its structure and its file names: the onboarding artwork imports them by path, and Icon Composer
    // resolves each layer by the name `icon.json` gives it.
    write(`build/${base}app-icon.icon/Assets/${family.vectorName}`, vector)
    const manifest = JSON.parse(readFileSync(join(DESKTOP_ROOT, 'build', base, 'app-icon.icon', 'icon.json'), 'utf8'))
    manifest.groups = manifest.groups.filter(group => group.name !== 'NEXT Badge')
    write(`build/${base}app-icon.icon/icon.json`, `${JSON.stringify(manifest, null, 2)}\n`)
    removed.push(`build/${base}app-icon.icon/Assets/NEXT Badge.svg`)
  }

  for (const size of LINUX_SIZES) write(`build/icons/${size}x${size}.png`, await png(windowsSource, size))

  const traySource = join(ASSET_DIRECTORY, 'icon.svg')
  write('assets/tray-iconTemplate.png', await silhouette(sharp, traySource, 16, '#000000'))
  write('assets/tray-iconTemplate@2x.png', await silhouette(sharp, traySource, 32, '#000000'))
  for (const [suffix, size] of [['', 16], ['@1.25x', 20], ['@1.5x', 24], ['@2x', 32]]) {
    write(`assets/tray-icon-blue${suffix}.png`, await silhouette(sharp, traySource, size, color))
  }

  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'overlay.json'), `${JSON.stringify({ written, removed }, null, 2)}\n`)
  return { out, written, removed }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  const out = argument('out') === undefined ? DEFAULT_OUT : resolve(argument('out'))
  const contract = argument('contract') === undefined ? DEFAULT_CONTRACT : resolve(argument('contract'))
  const result = await exportIcons({ out, contract })
  console.log(`icons: ${result.written.length} files in ${result.out}, ${result.removed.length} to remove`)
}
