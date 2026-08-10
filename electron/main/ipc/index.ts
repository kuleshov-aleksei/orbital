import { registerWindowIpc } from "./window"
import { registerConfigIpc } from "./config"
import { registerSystemIpc } from "./system"
import { registerScreenshareIpc } from "./screenshare"
import { registerVenmicIpc } from "./venmic"
import { registerUpdateIpc } from "./update"
import { registerOauthIpc } from "./oauth"

export function setupIPC() {
  registerWindowIpc()
  registerConfigIpc()
  registerSystemIpc()
  registerScreenshareIpc()
  registerVenmicIpc()
  registerUpdateIpc()
  registerOauthIpc()
}