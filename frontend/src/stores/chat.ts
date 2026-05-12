import { defineStore } from "pinia"
import { ref, computed } from "vue"
import type { ChatMessage } from "@/types"

export const useChatStore = defineStore("chat", () => {
  const messagesByRoom = ref<Map<string, ChatMessage[]>>(new Map())
  const isOpen = ref(false)
  const activeRoomId = ref<string | null>(null)
  const unreadCountByRoom = ref<Map<string, number>>(new Map())

  const totalUnreadCount = computed(() => {
    let total = 0
    unreadCountByRoom.value.forEach((count) => {
      total += count
    })
    return total
  })

  function getMessages(roomId: string): ChatMessage[] {
    return messagesByRoom.value.get(roomId) || []
  }

  function setMessages(roomId: string, messages: ChatMessage[]) {
    messagesByRoom.value.set(roomId, messages)
  }

  function addMessage(roomId: string, message: ChatMessage) {
    const messages = messagesByRoom.value.get(roomId) || []
    messages.push(message)
    messagesByRoom.value.set(roomId, messages)

    if (roomId !== activeRoomId.value || !isOpen.value) {
      const currentUnread = unreadCountByRoom.value.get(roomId) || 0
      unreadCountByRoom.value.set(roomId, currentUnread + 1)
    }
  }

  function clearRoomHistory(roomId: string) {
    messagesByRoom.value.delete(roomId)
    unreadCountByRoom.value.delete(roomId)
  }

  function setActiveRoom(roomId: string | null) {
    activeRoomId.value = roomId
    if (roomId) {
      unreadCountByRoom.value.set(roomId, 0)
    }
  }

  function openChat() {
    isOpen.value = true
    if (activeRoomId.value) {
      unreadCountByRoom.value.set(activeRoomId.value, 0)
    }
  }

  function closeChat() {
    isOpen.value = false
  }

  function toggleChat() {
    if (isOpen.value) {
      closeChat()
    } else {
      openChat()
    }
  }

  return {
    messagesByRoom,
    isOpen,
    activeRoomId,
    unreadCountByRoom,
    totalUnreadCount,
    getMessages,
    setMessages,
    addMessage,
    clearRoomHistory,
    setActiveRoom,
    openChat,
    closeChat,
    toggleChat,
  }
})
