import { registerWindowIpc } from "./window"
import { registerConfigIpc } from "./config"
import { registerSystemIpc } from "./system"
import { registerScreenshareIpc } from "./screenshare"
import { registerVenmicIpc } from "./venmic"
import { registerWinAudioIpc } from "./winAudio"
import { registerUpdateIpc } from "./update"
import { registerOauthIpc } from "./oauth"
import { registerMediaCacheIpc } from "./mediaCache"

export function setupIPC() {
  registerWindowIpc()
  registerConfigIpc()
  registerSystemIpc()
  registerScreenshareIpc()
  registerVenmicIpc()
  registerWinAudioIpc()
  registerUpdateIpc()
  registerOauthIpc()
  registerMediaCacheIpc()
}