/**
 * Injects uwork-aligned account menu & header styles into document.head during the plugin's lifetime.
 */
import type { Context } from '@deepseek-ai/cordis'

const STYLE_ID = 'yunwork-account-styles'

const CSS_TEXT = `
.yw-anchor { width: 100%; }
.yw-trigger {
  user-select: none;
  display: flex;
  align-items: center;
  width: 100%;
  height: 44px;
  gap: 8px;
  padding: 6px calc(var(--dsh-sidebar-row-padding, 12px) - var(--dsh-sidebar-paint-inset, 3px));
  border: 0;
  border-inline: var(--dsh-sidebar-paint-inset, 3px) solid transparent;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  background-clip: padding-box;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.yw-trigger[data-signed-out='false']:not([data-collapsed='true']) {
  padding: 6px;
  border-inline: 0;
  background-clip: border-box;
}
.yw-trigger[data-signed-out='true']:not([data-collapsed='true']) {
  height: 32px;
  line-height: 20px;
}
.yw-trigger[data-collapsed='true'] {
  width: 36px;
  height: 36px;
  justify-content: center;
  gap: 0;
  padding: 0;
  border-inline: 0;
  background-clip: border-box;
}
.yw-trigger[aria-expanded='true'],
.yw-trigger:hover {
  background-color: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}
.yw-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-tertiary, #888);
}
.yw-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.yw-signedOutMenu[role='menu'] {
  min-width: 124px;
  max-width: 280px;
  padding: 4px;
}
.yw-signedInMenu[role='menu'] {
  width: 304px;
  max-width: calc(100vw - 24px);
  padding: 6px;
}
.yw-headerRoot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px;
}
.yw-profileCard,
.yw-balanceCard {
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-card-tile-fill, var(--dsw-alias-bg-base, #fff));
}
.yw-profileCard {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.yw-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.yw-avatarLg {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--dsw-alias-bg-skeleton, rgba(0, 0, 0, 0.06));
  color: var(--dsw-alias-label-tertiary, #888);
}
.yw-identityCopy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.yw-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--dsw-alias-label-primary, inherit);
}
.yw-handle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary, #888);
}
.yw-iconActions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.yw-iconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #888);
  cursor: pointer;
}
.yw-iconButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, inherit);
}
.yw-balanceCard {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.yw-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.yw-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.yw-metricLabel {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary, #888);
}
.yw-metricValue {
  font-size: 16px;
  font-weight: 510;
  line-height: 22px;
  color: var(--dsw-alias-label-primary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.yw-metricSub {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.yw-ctaRow {
  display: flex;
  gap: 8px;
}
.yw-ctaButton {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 32px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.14));
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  cursor: pointer;
  white-space: nowrap;
}
.yw-ctaButton:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}
.yw-ctaPrimary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #111);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.yw-ctaPrimary:hover {
  background: var(--dsw-alias-button-primary-hover, #2a2a2a);
}
.yw-menuDivider {
  height: 1px;
  margin: 4px -6px;
  background: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
}
.yw-menuList {
  display: grid;
  gap: 2px;
}
.yw-menuItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}
.yw-menuItem:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}
.yw-menuItemLeading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
`

export function installYunworkStyles (ctx: Context): void {
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (style === null) {
      style = document.createElement('style')
      style.id = STYLE_ID
      document.head.appendChild(style)
    }
    style.textContent = CSS_TEXT
    return () => {
      style?.remove()
    }
  }, 'yunwork: account styles')
}
