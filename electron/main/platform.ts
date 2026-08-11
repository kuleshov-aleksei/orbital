import { app } from "electron"
import log from "electron-log"

// Media control keys can interfere with media objects in the app
app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling,MediaSessionService,WebRtcAllowInputVolumeAdjustment")

if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-gpu-sandbox")
  app.commandLine.appendSwitch("ignore-gpu-blocklist")
  app.commandLine.appendSwitch("use-angle", "d3d11")

  // https://github.com/electron/electron/issues/2237#issuecomment-126542840
  app.commandLine.appendSwitch("enable-usermedia-screen-capturing")
} else if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal,PipeWireCapturer")
}

app.commandLine.appendSwitch("webrtc-max-cpu-consumption-percentage", "100")
app.commandLine.appendSwitch("max-gum-fps", "60")
app.commandLine.appendSwitch("webrtc-max-capture-framerate", "60")

export const isWayland = process.platform === "linux" && 
  (process.env.XDG_SESSION_TYPE === "wayland" || 
   process.env.WAYLAND_DISPLAY !== undefined ||
   process.argv.includes("--ozone-platform=wayland"))

if (process.platform === "linux") {
  log.info("[Platform] Running on Wayland:", isWayland)
}

export const isDebugMode = process.argv.includes("--debug") || process.argv.includes("--devtools")

if (isDebugMode) {
  log.transports.file.level = "debug"
  log.info("[Debug] Debug mode enabled")
}