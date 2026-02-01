import { useUserStore, useAppStore, useCallStore } from '@/stores'
import { wsService } from '@/services/websocket'

export function useCallControls() {
  const userStore = useUserStore()
  const appStore = useAppStore()
  const callStore = useCallStore()

  const handleMuteToggle = (muted: boolean) => {
    callStore.setMuted(muted)
    
    // Notify WebSocket of mute status change only if connected
    if (wsService.isConnected()) {
      const userId = userStore.userId
      wsService.sendMessage('mute_status', {
        user_id: userId,
        is_muted: muted
      })
      wsService.sendMessage('speaking_status', {
        user_id: userId,
        is_speaking: false,
        is_muted: muted
      })
    }
  }

  const handleDeafenToggle = (deafened: boolean) => {
    callStore.setDeafened(deafened)
    
    // Notify WebSocket of deafen status change only if connected
    if (wsService.isConnected()) {
      const userId = userStore.userId
      wsService.sendMessage('deafen_status', {
        user_id: userId,
        is_deafened: deafened
      })
    }
  }

  const handleScreenShareToggle = () => {
    // This will be handled by VoiceCallView via template ref
    callStore.toggleScreenShare()
  }

  const handleNicknameChange = (userId: string, nickname: string) => {
    // Send nickname change via WebSocket
    wsService.changeNickname(userId, nickname)
    
    // Update current user if it's the current user
    if (userStore.userId === userId) {
      userStore.updateNickname(nickname)
    }
  }

  const handlePingUpdate = (ping: number, quality: 'excellent' | 'good' | 'fair' | 'poor') => {
    appStore.updateConnectionStatus(ping, quality)
  }

  return {
    isMuted: callStore.isMuted,
    isDeafened: callStore.isDeafened,
    isScreenSharing: callStore.isScreenSharing,
    connectionPing: appStore.connectionPing,
    connectionQuality: appStore.connectionQuality,
    handleMuteToggle,
    handleDeafenToggle,
    handleScreenShareToggle,
    handleNicknameChange,
    handlePingUpdate
  }
}
