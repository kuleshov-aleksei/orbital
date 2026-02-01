import { useUserStore, useAppStore } from '@/stores'
import { wsService } from '@/services/websocket'

export function useCallControls() {
  const userStore = useUserStore()
  const appStore = useAppStore()

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
    handleNicknameChange,
    handlePingUpdate
  }
}
