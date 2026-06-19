import { WebSocketConnection } from "./connection"
import { MessageBus } from "./messageBus"
import type { WebSocketMessage } from "@/types"

export type { MessageCallback, ConnectionCallback, DisconnectionCallback } from "./messageBus"
export type {
  ConnectionEventListener,
  DisconnectionEventListener,
  MessageEventListener,
} from "./connection"

export class WebSocketService {
  private roomConnection = new WebSocketConnection()
  private globalConnection = new WebSocketConnection()
  private roomBus = new MessageBus()
  private globalBus = new MessageBus()
  private roomId = ""
  private userId = ""

  connect(roomId: string, userId: string): Promise<void> {
    this.roomId = roomId
    this.userId = userId

    this.roomConnection.onMessage = (event) => {
      this.handleRoomMessage(event)
    }

    this.roomConnection.onConnected = () => {
      this.sendJoinRoom()
      this.roomBus.notifyConnected()
    }

    this.roomConnection.onDisconnected = (event) => {
      this.roomBus.notifyDisconnected(event)
    }

    return this.roomConnection.connect(roomId)
  }

  connectGlobal(): Promise<void> {
    this.globalConnection.onMessage = (event) => {
      this.handleGlobalMessage(event)
    }

    this.globalConnection.onConnected = () => {
      this.globalBus.notifyConnected()
    }

    this.globalConnection.onDisconnected = (event) => {
      this.globalBus.notifyDisconnected(event)
    }

    return this.globalConnection.connect({ isGlobal: true })
  }

  disconnect(): void {
    this.roomConnection.disconnect()
  }

  async disconnectGlobal(): Promise<void> {
    await this.globalConnection.disconnectGraceful()
  }

  private sendJoinRoom(): void {
    const nickname =
      localStorage.getItem("orbital_user_nickname") || `User_${this.userId.substr(0, 8)}`

    this.sendMessage("join_room", {
      room_id: this.roomId,
      user_id: this.userId,
      nickname,
    })
  }

  sendMessage(type: WebSocketMessage["type"], data: unknown): void {
    const message: WebSocketMessage = { type, data }
    this.roomConnection.send(JSON.stringify(message))
  }

  sendGlobalMessage(type: WebSocketMessage["type"], data: unknown): void {
    const message: WebSocketMessage = { type, data }
    this.globalConnection.send(JSON.stringify(message))
  }

  changeNickname(userId: string, nickname: string): void {
    this.sendGlobalMessage("nickname_change", {
      user_id: userId,
      nickname,
    })
  }

  sendMuteState(roomId: string, isMuted: boolean): void {
    this.sendGlobalMessage("update_mute_state", {
      room_id: roomId,
      is_muted: isMuted,
    })
  }

  sendDeafenState(roomId: string, isDeafened: boolean): void {
    this.sendGlobalMessage("update_deafen_state", {
      room_id: roomId,
      is_deafened: isDeafened,
    })
  }

  sendChatMessage(content: string): void {
    this.sendMessage("send_message", { content })
  }

  on(type: string, callback: (message: WebSocketMessage) => void): void {
    this.roomBus.on(type, callback)
  }

  onGlobal(type: string, callback: (message: WebSocketMessage) => void): void {
    this.globalBus.on(type, callback)
  }

  onConnection(callback: () => void): void {
    this.roomBus.onConnection(callback)
  }

  onDisconnection(callback: (event: CloseEvent) => void): void {
    this.roomBus.onDisconnection(callback)
  }

  onGlobalConnection(callback: () => void): void {
    this.globalBus.onConnection(callback)
  }

  onGlobalDisconnection(callback: (event: CloseEvent) => void): void {
    this.globalBus.onDisconnection(callback)
  }

  off(type: string, callback?: (message: WebSocketMessage) => void): void {
    this.roomBus.off(type, callback)
  }

  offGlobal(type: string, callback?: (message: WebSocketMessage) => void): void {
    this.globalBus.off(type, callback)
  }

  removeConnectionCallback(callback: () => void): void {
    this.roomBus.removeConnectionCallback(callback)
  }

  removeDisconnectionCallback(callback: (event: CloseEvent) => void): void {
    this.roomBus.removeDisconnectionCallback(callback)
  }

  removeGlobalConnectionCallback(callback: () => void): void {
    this.globalBus.removeConnectionCallback(callback)
  }

  removeGlobalDisconnectionCallback(callback: (event: CloseEvent) => void): void {
    this.globalBus.removeDisconnectionCallback(callback)
  }

  isConnected(): boolean {
    return this.roomConnection.isConnected()
  }

  isGlobalConnected(): boolean {
    return this.globalConnection.isConnected()
  }

  getReadyState(): number {
    return this.roomConnection.getReadyState()
  }

  getGlobalReadyState(): number {
    return this.globalConnection.getReadyState()
  }

  private handleRoomMessage(event: MessageEvent<unknown>): void {
    try {
      const message = JSON.parse(event.data as string) as WebSocketMessage
      this.roomBus.routeMessage(message)
    } catch (error) {
      console.error("Error parsing WebSocket message:", error, event.data)
    }
  }

  private handleGlobalMessage(event: MessageEvent<unknown>): void {
    try {
      const message = JSON.parse(event.data as string) as WebSocketMessage
      this.globalBus.routeMessage(message)
    } catch (error) {
      console.error("Error parsing global WebSocket message:", error, event.data)
    }
  }
}

export const wsService = new WebSocketService()
