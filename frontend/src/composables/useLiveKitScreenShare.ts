import { useScreenShareCore } from "./useScreenShareCore"
import { useBrowserScreenShare } from "./useBrowserScreenShare"
import { useElectronScreenShare } from "./useElectronScreenShare"
import type { LiveKitState } from "./useLiveKitState"

export function useLiveKitScreenShare(state: LiveKitState) {
  const core = useScreenShareCore(state)
  const browser = useBrowserScreenShare(state, core.stopScreenShare)
  const electron = useElectronScreenShare(state, core.stopScreenShare, core.withTimeout)

  return {
    startScreenShare: browser.startScreenShare,
    startElectronScreenShare: electron.startElectronScreenShare,
    stopScreenShare: core.stopScreenShare,
    subscribeToScreenShare: core.subscribeToScreenShare,
    unsubscribeFromScreenShare: core.unsubscribeFromScreenShare,
    subscribedScreenShares: core.subscribedScreenShares,
    screenShareData: core.screenShareData,
    availableScreenShares: core.availableScreenShares,
    isRunningInElectron: core.isRunningInElectron,
  }
}
