import { wsService } from "@/services/websocket"
import type { MessageCallback } from "@/services/websocket"
import type { ChatMessage } from "@/types"

export function setupChatHandlers(
  chatStore: {
    setMessages: (roomId: string, messages: ChatMessage[]) => void
    setActiveRoom: (roomId: string) => void
    addMessage: (roomId: string, message: ChatMessage) => void
  },
  cleanupFns: Array<() => void>,
): void {
  const onChatHistory: MessageCallback = (message) => {
    const data = message.data as { room_id: string; messages: ChatMessage[] }
    chatStore.setMessages(data.room_id, data.messages)
    chatStore.setActiveRoom(data.room_id)
  }
  wsService.on("chat_history", onChatHistory)
  cleanupFns.push(() => wsService.off("chat_history", onChatHistory))

  const onNewMessage: MessageCallback = (message) => {
    const data = message.data as { room_id: string; message: ChatMessage }
    chatStore.addMessage(data.room_id, data.message)
  }
  wsService.on("new_message", onNewMessage)
  cleanupFns.push(() => wsService.off("new_message", onNewMessage))
}
