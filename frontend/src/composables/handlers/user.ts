import { wsService } from "@/services/websocket"
import type { MessageCallback } from "@/services/websocket"
import { debugLog } from "@/utils/debug"
import type { User, PublicUser } from "@/types"

export function setupUserHandlers(
  roomStore: {
    setCurrentRoomUsers: (users: User[]) => void
    updateCurrentRoomUser: (userId: string, updates: Partial<User>) => void
    updateUserNickname: (userId: string, nickname: string) => void
  },
  usersStore: {
    allUsers: Array<{
      id: string
      nickname: string
      avatar_url?: string
      role: string
      is_online: boolean
    }>
    updateOnlineStatus: (userId: string, isOnline: boolean) => void
    addUser: (user: {
      id: string
      nickname: string
      avatar_url: string
      role: PublicUser["role"]
      is_online: boolean
    }) => void
    updateUser: (user: {
      id: string
      nickname?: string
      avatar_url?: string
      role?: string
      is_online?: boolean
    }) => void
    fetchAllUsers: () => Promise<void>
  },
  userStore: {
    updateGlobalUserAudioState: (
      userId: string,
      state: { room_id: string; is_muted: boolean; is_deafened: boolean },
    ) => void
  },
  cleanupFns: Array<() => void>,
): void {
  const onRoomUsers: MessageCallback = (message) => {
    const data = message.data as User[]
    roomStore.setCurrentRoomUsers(data)
  }
  wsService.on("room_users", onRoomUsers)
  cleanupFns.push(() => wsService.off("room_users", onRoomUsers))

  const onNicknameChange: MessageCallback = (message) => {
    const data = message.data as { user_id: string; nickname: string }
    roomStore.updateCurrentRoomUser(data.user_id, { nickname: data.nickname })
    roomStore.updateUserNickname(data.user_id, data.nickname)
  }
  wsService.on("nickname_change", onNicknameChange)
  cleanupFns.push(() => wsService.off("nickname_change", onNicknameChange))

  const onGlobalNicknameChange: MessageCallback = (message) => {
    const data = message.data as { user_id: string; nickname: string }
    roomStore.updateUserNickname(data.user_id, data.nickname)
    usersStore.updateUserNickname(data.user_id, data.nickname)
  }
  wsService.onGlobal("nickname_change", onGlobalNicknameChange)
  cleanupFns.push(() => wsService.offGlobal("nickname_change", onGlobalNicknameChange))

  const onUserOnline: MessageCallback = (message) => {
    const data = message.data as {
      id: string
      nickname: string
      avatar_url?: string
      role: string
      is_online: boolean
    }
    debugLog("[WebSocket] User came online:", data.id, data.nickname)
    const existingUser = usersStore.allUsers.find((u) => u.id === data.id)
    if (existingUser) {
      usersStore.updateOnlineStatus(data.id, true)
    } else {
      usersStore.addUser({
        id: data.id,
        nickname: data.nickname,
        avatar_url: data.avatar_url || "",
        role: data.role as PublicUser["role"],
        is_online: true,
      })
    }
  }
  wsService.onGlobal("user_online", onUserOnline)
  cleanupFns.push(() => wsService.offGlobal("user_online", onUserOnline))

  const onUserOffline: MessageCallback = (message) => {
    const data = message.data as { id: string }
    usersStore.updateOnlineStatus(data.id, false)
  }
  wsService.onGlobal("user_offline", onUserOffline)
  cleanupFns.push(() => wsService.offGlobal("user_offline", onUserOffline))

  const onOnlineUsers: MessageCallback = (message) => {
    const data = message.data as {
      users: Array<{
        id: string
        nickname: string
        avatar_url?: string
        role: string
        is_online: boolean
      }>
    }
    data.users.forEach((user) => {
      usersStore.updateUser({
        id: user.id,
        nickname: user.nickname,
        avatar_url: user.avatar_url,
        role: user.role,
        is_online: user.is_online,
      })
    })
    const onlineUserIds = new Set(data.users.map((u) => u.id))
    usersStore.allUsers.forEach((user) => {
      if (user.is_online && !onlineUserIds.has(user.id)) {
        usersStore.updateOnlineStatus(user.id, false)
      }
    })
  }
  wsService.onGlobal("online_users", onOnlineUsers)
  cleanupFns.push(() => wsService.offGlobal("online_users", onOnlineUsers))

  const onAudioStates: MessageCallback = (message) => {
    const data = message.data as {
      states: Array<{
        user_id: string
        room_id: string
        is_muted: boolean
        is_deafened: boolean
      }>
    }
    debugLog("[WebSocket] Received audio_states:", data.states.length, "users")
    data.states.forEach((state) => {
      userStore.updateGlobalUserAudioState(state.user_id, {
        room_id: state.room_id,
        is_muted: state.is_muted,
        is_deafened: state.is_deafened,
      })
    })
  }
  wsService.onGlobal("audio_states", onAudioStates)
  cleanupFns.push(() => wsService.offGlobal("audio_states", onAudioStates))

  const onUserAudioState: MessageCallback = (message) => {
    const data = message.data as {
      user_id: string
      room_id: string
      is_muted: boolean
      is_deafened: boolean
    }
    debugLog(
      "[WebSocket] User audio state changed:",
      data.user_id,
      "room:",
      data.room_id,
      "muted:",
      data.is_muted,
      "deafened:",
      data.is_deafened,
    )
    userStore.updateGlobalUserAudioState(data.user_id, {
      room_id: data.room_id,
      is_muted: data.is_muted,
      is_deafened: data.is_deafened,
    })
  }
  wsService.onGlobal("user_audio_state", onUserAudioState)
  cleanupFns.push(() => wsService.offGlobal("user_audio_state", onUserAudioState))
}
