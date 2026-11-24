/**
 * The plugin's own volatile configuration: what the account writes into DSH's local files.
 *
 * It follows the repository's real pattern — the Config's `Volatile` references read live, saved through the
 * configuration editor into the active Profile's patch — rather than a settings namespace of its own. A change never
 * reloads the plugin, so a sign-in in progress carries on.
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-config-editor'

/** The plugin's Config references this class reads. */
export interface SettingsConfig {
  /** Keep the language key in DSH's credentials document, where the model route reads it. */
  readonly storeKey: Volatile<boolean>
  /** Write the account's models into the active Profile's configuration; they need the stored key. */
  readonly writeModels: Volatile<boolean>
}

export type SettingName = keyof SettingsConfig

/** What the account may write into DSH's local files, as the configuration says it now. */
export interface LocalFiles {
  storeKey (): boolean
  writeModels (): boolean
  readonly writable: boolean
  save (change: Partial<Record<SettingName, boolean>>): Promise<void>
}

export class YunworkSettings {
  private saves: Promise<unknown> = Promise.resolve()

  /**
   * @param owner - the plugin's own context, whose Loader entry the configuration belongs to.
   * @param config - its Config references.
   */
  constructor (private readonly owner: Context, private readonly config: SettingsConfig) {}

  get<N extends SettingName> (name: N): ReturnType<SettingsConfig[N]['get']> {
    return this.config[name].get() as ReturnType<SettingsConfig[N]['get']>
  }

  /** Whether a configuration editor can save a change. */
  get writable (): boolean {
    return this.owner.fiber.entry !== undefined && this.owner.get('configEditor') !== undefined
  }

  /** The account's view of what it may write; the models need the key, so one switch implies the other. */
  local (): LocalFiles {
    const settings = this
    return {
      storeKey: () => settings.get('storeKey'),
      writeModels: () => settings.get('storeKey') && settings.get('writeModels'),
      get writable () { return settings.writable },
      save: change => settings.save(change),
    }
  }

  /** Save a change; saves commit in the order they came. */
  async save (change: Partial<Record<SettingName, boolean>>): Promise<void> {
    const entry = this.owner.fiber.entry
    const editor = this.owner.get('configEditor')
    if (entry === undefined || editor === undefined) throw new Error('the configuration is not editable')
    const saved = this.saves.then(() => editor.edit(entry, current => ({ ...current, ...change })))
    this.saves = saved.catch(() => {})
    await saved
  }
}
