import { ipcMain } from "electron"
import log from "electron-log"
import {
  startOAuthCallbackServer,
  stopOAuthCallbackServer,
  resolveOAuthCallback,
  OAUTH_CALLBACK_PORT,
} from "../features/oauth"

export function registerOauthIpc() {
  ipcMain.handle("oauth-authenticate", async () => {
    log.info("[OAuth] Starting OAuth authentication flow")

    try {
      await startOAuthCallbackServer()
      return { port: OAUTH_CALLBACK_PORT }
    } catch (error) {
      log.error("[OAuth] Failed to start callback server:", error)
      throw error
    }
  })

  ipcMain.handle("oauth-callback", async (_, token: string) => {
    log.info("[OAuth] Token received from callback")

    resolveOAuthCallback(token)
    return true
  })
}