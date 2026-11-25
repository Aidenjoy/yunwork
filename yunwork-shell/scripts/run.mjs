/**
 * One entry point for developing, building and packaging the desktop shell under our brand.
 *
 * The base desktop reads exactly one brand seam from its environment, `DSH_DESKTOP_NEXT_HOME`,
 * which moves the data directory into our own home. Everything else this script sets is a
 * contract with `dsh-yunwork-platform`: `YUNWORK_RUNTIME` points at the generated runtime config
 * and `YUNWORK_ENV` names the environment, so the plugin can behave differently per environment
 * without the base knowing anything about us.
 *
 * The base commands themselves are untouched: this wrapper regenerates the runtime config and then
 * runs the same root script a developer would type by hand. Passing arguments after `--` forwards
 * them to the base script unchanged.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { availableEnvironments } from './resolve-profile.mjs'
import { prepareBrand } from './prepare-brand.mjs'
import { exportIcons } from './export-yunwork-icons.mjs'
import { applyOverlay, restoreOverlay } from './icon-overlay.mjs'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..')
const DESKTOP_ROOT = join(REPOSITORY_ROOT, 'dsh-desktop-next')

/** The contract the payload carries: `prepare-payload.ts` copies it only when it is in the package directory. */
const PAYLOAD_CONTRACT = 'yunwork-runtime.json'

/** The command each environment-independent action maps to, given the host platform. */
const COMMANDS = {
  // `dev:next`, `package:dir:next` and `dist:*:next` start with `market:prepare`, which follows npm `latest`. When a
  // version is announced before its tarball reaches the registry (dshmarket 1.80.2 was one such window) that step
  // fails and takes the whole command down, even though the committed market bundle is installed and works. The
  // `*:yunwork` entries skip that refresh: the pinned build is what a reproducible branded launch wants anyway.
  dev: { script: () => 'dev:yunwork', summary: 'run the desktop against the workspace sources' },
  build: { script: () => 'package:dir:yunwork', summary: 'package an unpacked application directory' },
  dist: {
    script: platform => {
      if (platform === 'win32') return 'dist:win:yunwork'
      if (platform === 'darwin') return 'dist:mac:yunwork'
      return undefined
    },
    summary: 'build the installable artifact for this platform',
  },
}

/** Characters a shell would interpret; forwarding them would silently rewrite the command. */
const SHELL_UNSAFE = /["&|<>^%`$\r\n]/

function usage () {
  return [
    'Usage: node run.mjs <dev|build|dist> [--env=<name>] [--dry-run] [-- <base arguments>]',
    '',
    'Regenerates the runtime contract with prepare-brand.mjs, then runs the base desktop script.',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([name, entry]) => `  ${name.padEnd(6)} ${entry.summary}`),
    '',
    'Options:',
    '  --env=<name>  Brand environment. Default: YUNWORK_ENV, then dev.',
    `                Available: ${availableEnvironments().join(', ')}`,
    '  --dry-run     Print the command and the injected environment without running anything.',
    '  --help        Show this message.',
    '',
    'Injected environment:',
    '  DSH_DESKTOP_NEXT_HOME  Data directory. Default $HOME/<dataDirName>, override YUNWORK_DATA_HOME.',
    '  YUNWORK_RUNTIME        Absolute path of the generated .yunwork-build/yunwork-runtime.json.',
    '  YUNWORK_ENV            The brand environment this run belongs to.',
    '',
    'Arguments after `--` are forwarded to the base script. Exit code is the base command\'s.',
  ].join('\n')
}

function parseArguments (argv) {
  const options = { passthrough: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') {
      options.passthrough = argv.slice(index + 1)
      break
    }
    if (argument === '--help' || argument === '-h') { options.help = true; continue }
    if (argument === '--dry-run') { options.dryRun = true; continue }
    if (argument === '--env') {
      options.env = argv[index + 1]
      index += 1
      if (options.env === undefined) throw new Error('--env requires a value')
      continue
    }
    if (argument.startsWith('--env=')) { options.env = argument.slice('--env='.length); continue }
    if (argument.startsWith('-')) throw new Error(`Unknown option "${argument}"`)
    if (options.command !== undefined) throw new Error(`Unexpected argument "${argument}"; the command is already "${options.command}"`)
    options.command = argument
  }
  return options
}

/** Whether a package-manager shim is runnable. Yarn 4 is reached through corepack on a bare host. */
function isRunnable (name) {
  const probe = spawnSync(name, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
  return probe.status === 0
}

function packageManager () {
  const configured = process.env.YUNWORK_PM
  if (configured !== undefined && configured.trim() !== '') return { command: configured.trim(), prefix: [] }
  if (isRunnable('yarn')) return { command: 'yarn', prefix: [] }
  if (isRunnable('corepack')) return { command: 'corepack', prefix: ['yarn'] }
  throw new Error('Neither yarn nor corepack is available. Set YUNWORK_PM to the yarn executable to use.')
}

function quoteForShell (token) {
  if (SHELL_UNSAFE.test(token)) throw new Error(`Refusing to forward "${token}": it contains a shell metacharacter`)
  return /\s/.test(token) ? `"${token}"` : token
}

function dataHome (runtime) {
  const configured = process.env.YUNWORK_DATA_HOME
  if (configured !== undefined && configured.trim() !== '') return resolve(configured.trim())
  // The base resolves this variable with path.resolve, so a relative value would follow the
  // caller's working directory. Always hand it an absolute path.
  return join(homedir(), runtime.dataDirName)
}

/**
 * Seed the optional Desktop bundles in a brand-new home.
 *
 * A fresh profile starts with only the two base bundles, which leaves remote control and the market off even though
 * both are installed. This writes one small profile manifest before the base starts, and never touches an existing
 * profile: user settings, credentials and session state stay entirely theirs.
 * @param home - the data directory this run uses.
 * @returns true when a new profile was created.
 */
function seedDesktopProfile (home) {
  const directory = join(home, 'profiles', 'desktop')
  const path = join(directory, 'package.json')
  if (existsSync(path)) return false
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app',
          'dshmarket',
          '@agents-anywhere/dsh-bridge-next',
          '@deepseek-ai/dsh-cua-bundle',
          '@deepseek-ai/dsh-experimental-subagent-oar',
          '@deepseek-ai/dsh-experimental-badge-skill-bundle',
          '@deepseek-ai/dsh-experimental-cot-translation-bundle',
          '@deepseek-ai/dsh-experimental-forge-bundle',
          '@deepseek-ai/dsh-experimental-ralph-bundle',
          '@deepseek-ai/dsh-experimental-session-titles-bundle',
          '@deepseek-ai/dsh-experimental-terminal-bundle',
          '@deepseek-ai/dsh-experimental-voice-input-bundle',
        ],
      },
      desktopScheduleBundleRetired: true,
    },
  }, null, 2)}\n`)
  return true
}

async function main (argv) {
  const options = parseArguments(argv)
  if (options.help === true) {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  if (options.command === undefined) {
    process.stderr.write(`run: a command is required\n\n${usage()}\n`)
    return 1
  }

  const entry = COMMANDS[options.command]
  if (entry === undefined) {
    process.stderr.write(`run: unknown command "${options.command}". Expected one of: ${Object.keys(COMMANDS).join(', ')}\n`)
    return 1
  }
  const script = entry.script(process.platform)
  if (script === undefined) {
    process.stderr.write(`run: "${options.command}" is not supported on ${process.platform} yet\n`)
    return 1
  }

  const { runtime, runtimePath, warnings } = prepareBrand({
    env: options.env,
    onWarning: message => process.stderr.write(`run: ${message}\n`),
  })
  if (warnings.length > 0) process.stderr.write(`run: ${warnings.length} warning(s)\n`)

  const home = dataHome(runtime)
  const environment = {
    ...process.env,
    YUNWORK_ENV: runtime.env,
  }

  // Packaging asks the desktop for our name, our bundle id and our artifact names. The flags themselves live in the
  // base's `scripts/package.ts`, which adds them only when this variable points at a readable file.
  const packaging = options.command !== 'dev'
  if (packaging) {
    delete environment.YUNWORK_RUNTIME
    delete environment.DSH_DESKTOP_NEXT_HOME
  } else {
    environment.DSH_DESKTOP_NEXT_HOME = home
    environment.YUNWORK_RUNTIME = runtimePath
  }
  const brandConfigPath = join(dirname(runtimePath), 'electron-builder-brand.json')
  if (packaging) {
    writeFileSync(brandConfigPath, `${JSON.stringify({
      productName: runtime.productName, appId: runtime.appId, artifactPrefix: runtime.artifactPrefix,
    }, null, 2)}\n`)
    environment.YUNWORK_BRAND_CONFIG = brandConfigPath
  }

  // `DSH_AA_SOURCE_REF` is no longer anchored to vendor/agents-anywhere/provenance.json;
  // yunwork uses its own @agents-anywhere/dsh-bridge-next tarball in vendor/yundashi/.
  const anchoredCommit = undefined

  const manager = packageManager()
  const tokens = [...manager.prefix, script, ...options.passthrough]
  const shell = process.platform === 'win32'
  const printed = [manager.command, ...tokens].map(token => (shell ? quoteForShell(token) : token)).join(' ')

  process.stdout.write(`run: env=${runtime.env} command=${options.command}\n`)
  process.stdout.write(`run: DSH_DESKTOP_NEXT_HOME=${home}\n`)
  process.stdout.write(`run: YUNWORK_RUNTIME=${runtimePath}\n`)
  process.stdout.write(`run: YUNWORK_ENV=${runtime.env}\n`)
  if (packaging) process.stdout.write(`run: YUNWORK_BRAND_CONFIG=${brandConfigPath}\n`)
  process.stdout.write(anchoredCommit === undefined
    ? `run: DSH_AA_SOURCE_REF unset (${options.command === 'dist' ? 'a release must verify against the official main' : 'no provenance commit found'})\n`
    : `run: DSH_AA_SOURCE_REF=${anchoredCommit}\n`)
  process.stdout.write(`run: $ ${printed}\n`)

  if (options.dryRun === true) return 0

  if (!packaging) {
    // The base creates its own data directory, but failing here with a clear path beats a launch
    // that dies later inside Electron with a permission error.
    mkdirSync(home, { recursive: true, mode: 0o700 })
    if (seedDesktopProfile(home)) process.stdout.write('run: seeded a fresh desktop profile with the market and remote-control bundles\n')
  }

  // Both artefacts of a packaged build live in the base only while it runs: the icons replace tracked artwork, and the
  // contract is a file the payload copies. `finally` puts the tree back even when the base command fails.
  const buildDirectory = dirname(runtimePath)
  let applied = false
  if (packaging) {
    const icons = await exportIcons({ contract: runtimePath })
    applyOverlay({ overlayDir: icons.out, desktopRoot: DESKTOP_ROOT, backupDir: join(buildDirectory, 'icons-backup') })
    writeFileSync(join(DESKTOP_ROOT, PAYLOAD_CONTRACT), readFileSync(runtimePath))
    applied = true
    process.stdout.write(`run: applied ${icons.written.length} brand icons and the runtime contract\n`)
  }

  try {
    // With `shell: true` Node joins the argument array with spaces and cmd.exe reparses the result, silently splitting
    // an argument that contains spaces. Build one quoted command line instead, with the same tokens the dry run prints.
    // `quoteForShell` has already refused every cmd metacharacter, so this join cannot turn an argument into a command.
    const child = shell
      ? spawn(printed, { cwd: REPOSITORY_ROOT, env: environment, stdio: 'inherit', shell: true })
      : spawn(manager.command, tokens, { cwd: REPOSITORY_ROOT, env: environment, stdio: 'inherit', shell: false })

    return await new Promise(resolvePromise => {
      child.on('error', error => {
        process.stderr.write(`run: failed to start "${printed}": ${error.message}\n`)
        resolvePromise(1)
      })
      child.on('close', (code, signal) => {
        if (signal !== null) {
          process.stderr.write(`run: "${printed}" was terminated by ${signal}\n`)
          resolvePromise(1)
          return
        }
        if (code !== 0) process.stderr.write(`run: "${printed}" exited with code ${code}\n`)
        resolvePromise(code ?? 1)
      })
    })
  } finally {
    if (applied) {
      const restored = restoreOverlay({ desktopRoot: DESKTOP_ROOT, backupDir: join(buildDirectory, 'icons-backup') })
      rmSync(join(DESKTOP_ROOT, PAYLOAD_CONTRACT), { force: true })
      process.stdout.write(`run: restored ${restored} files and removed the runtime contract\n`)
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`run: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
