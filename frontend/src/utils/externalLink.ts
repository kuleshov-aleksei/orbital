import { isElectron, openExternal } from "@/services/electron"

/**
 * Click handler for <a target="_blank"> links to other sites: Electron
 * would open them in a new app window, so they go to the system browser.
 */
export function openLinkExternally(event: MouseEvent, href: string) {
  if (isElectron()) {
    event.preventDefault()
    void openExternal(href)
  }
}
