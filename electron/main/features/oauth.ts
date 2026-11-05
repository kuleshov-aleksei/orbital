import http from "node:http"
import log from "electron-log"
import { getMainWindow } from "../state"

export const OAUTH_CALLBACK_PORT = 27271

let oauthCallbackServer: http.Server | null = null
let oauthCallbackResolve: ((token: string) => void) | null = null
let expectedOAuthState: string | null = null

export function startOAuthCallbackServer(state: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (oauthCallbackServer) {
      oauthCallbackServer.close()
    }
    expectedOAuthState = state

    oauthCallbackServer = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${OAUTH_CALLBACK_PORT}`)

      const pathname = url.pathname.replace(/\/$/, "") // Remove trailing slash
      if (pathname === "/callback") {
        const token = url.searchParams.get("token")
        const expires = url.searchParams.get("expires")
        const state = url.searchParams.get("state")

        if (!expectedOAuthState || state !== expectedOAuthState) {
          log.warn("[OAuth] Callback state mismatch; refusing token")
          expectedOAuthState = null
          res.writeHead(400, { "Content-Type": "text/html" })
          res.end("<h1>Authentication Failed</h1><p>Invalid OAuth state.</p>")
          oauthCallbackServer?.close()
          oauthCallbackServer = null
          return
        }

        log.info("[OAuth] Token found:", token !== null)
        log.info("[OAuth] Expires found:", expires !== null)

        if (token) {
          expectedOAuthState = null
          res.writeHead(200, { "Content-Type": "text/html" })
          res.end(`
            <html>
              <body>
                <h1>Authentication Successful!</h1>
                <p>You can close this window and return to Orbital.</p>
                <script>
                  setTimeout(() => window.close(), 2000)
                </script>
              </body>
            </html>
          `)

          const mainWindow = getMainWindow()
          if (mainWindow) {
            mainWindow.webContents.send("oauth-token", { token, expires })
            log.info("[OAuth] Token sent to renderer")
          }

          setTimeout(() => {
            oauthCallbackServer?.close()
            oauthCallbackServer = null
          }, 1000)
        } else {
          res.writeHead(400, { "Content-Type": "text/html" })
          res.end("<h1>Authentication Failed</h1><p>No token received.</p>")
        }
      } else {
        res.writeHead(404, { "Content-Type": "text/html" })
        res.end("<h1>Not Found</h1>")
      }
    })

    oauthCallbackServer.on("error", (err: Error) => {
      log.error("[OAuth] Server error:", err)
      reject(err)
    })

    oauthCallbackServer.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", () => {
      log.info(`[OAuth] Callback server started on http://127.0.0.1:${OAUTH_CALLBACK_PORT} and http://localhost:${OAUTH_CALLBACK_PORT}`)
      resolve()
    })
  })
}

export function stopOAuthCallbackServer() {
  expectedOAuthState = null
  if (oauthCallbackServer) {
    oauthCallbackServer.close()
    oauthCallbackServer = null
    log.info("[OAuth] Callback server stopped")
  }
}

export function resolveOAuthCallback(token: string): void {
  if (oauthCallbackResolve) {
    oauthCallbackResolve(token)
    oauthCallbackResolve = null
  }
  stopOAuthCallbackServer()
}