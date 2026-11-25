/**
 * Lay the brand icons over the base desktop for one packaging run, then put everything back.
 *
 * The base desktop keeps its own artwork in tracked files, and its tests hash them. Replacing those files in the
 * repository would turn every sync into a binary conflict, so the brand artwork is applied only while packaging runs:
 * each file it touches is copied aside first, and `restoreOverlay` puts the copies back — including deleting files the
 * overlay introduced and recreating files the overlay removed.
 *
 * The plan is written to disk before the first change, so a run that dies without unwinding still leaves the exact list
 * of what has to be restored. `run.mjs` always restores in a `finally`, and re-running restore is safe.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const STATE_FILE = 'overlay-state.json'

/**
 * Copy the overlay over the desktop, keeping a copy of every file it replaces or removes.
 * @param options.overlayDir - Directory holding the generated tree and its `overlay.json`.
 * @param options.desktopRoot - The application package the overlay is laid over.
 * @param options.backupDir - Where the replaced files are kept until the restore.
 * @returns The number of files written and removed.
 */
export function applyOverlay ({ overlayDir, desktopRoot, backupDir }) {
  if (existsSync(join(backupDir, STATE_FILE))) {
    restoreOverlay({ desktopRoot, backupDir })
  }
  const plan = JSON.parse(readFileSync(join(overlayDir, 'overlay.json'), 'utf8'))
  mkdirSync(backupDir, { recursive: true })
  /** Recorded before acting, so an interrupted run can still be undone exactly. */
  const state = { written: [], removed: [] }
  const save = () => writeFileSync(join(backupDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`)
  save()
  for (const path of plan.written) {
    const destination = join(desktopRoot, ...path.split('/'))
    const backup = join(backupDir, ...path.split('/'))
    const existed = existsSync(destination)
    if (existed) {
      mkdirSync(dirname(backup), { recursive: true })
      cpSync(destination, backup)
    }
    state.written.push({ path, existed })
    save()
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(join(overlayDir, ...path.split('/')), destination)
  }
  for (const path of plan.removed) {
    const destination = join(desktopRoot, ...path.split('/'))
    const backup = join(backupDir, ...path.split('/'))
    const existed = existsSync(destination)
    if (existed) {
      mkdirSync(dirname(backup), { recursive: true })
      cpSync(destination, backup)
      rmSync(destination)
    }
    state.removed.push({ path, existed })
    save()
  }
  return { written: state.written.length, removed: state.removed.length }
}

/**
 * Undo `applyOverlay`: restore every replaced or removed file and drop the ones the overlay added.
 * @param options.desktopRoot - The application package the overlay was laid over.
 * @param options.backupDir - The directory `applyOverlay` recorded its state in.
 * @returns The number of files restored or deleted, or 0 when there was nothing to undo.
 */
export function restoreOverlay ({ desktopRoot, backupDir }) {
  const statePath = join(backupDir, STATE_FILE)
  if (!existsSync(statePath)) return 0
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  let touched = 0
  for (const entry of [...state.written, ...state.removed]) {
    const destination = join(desktopRoot, ...entry.path.split('/'))
    const backup = join(backupDir, ...entry.path.split('/'))
    if (existsSync(backup)) {
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(backup, destination)
      touched += 1
    } else if (existsSync(destination)) {
      // The overlay introduced this file; it has no earlier version to go back to.
      rmSync(destination)
      touched += 1
    }
  }
  rmSync(statePath)
  return touched
}
