import type { WebSocketMessage } from "@/types"

export type MessageCallback = (message: WebSocketMessage) => void
export type ConnectionCallback = () => void
export type DisconnectionCallback = (event: CloseEvent) => void

export class MessageBus {
  private callbacks = new Map<string, MessageCallback[]>()
  private connectionCallbacks: ConnectionCallback[] = []
  private disconnectionCallbacks: DisconnectionCallback[] = []

  on(type: string, callback: MessageCallback): void {
    if (!this.callbacks.has(type)) {
      this.callbacks.set(type, [])
    }
    this.callbacks.get(type)!.push(callback)
  }

  off(type: string, callback?: MessageCallback): void {
    if (callback) {
      const callbacks = this.callbacks.get(type)
      if (callbacks) {
        const index = callbacks.indexOf(callback)
        if (index > -1) {
          callbacks.splice(index, 1)
        }
      }
    } else {
      this.callbacks.delete(type)
    }
  }

  onConnection(callback: ConnectionCallback): void {
    this.connectionCallbacks.push(callback)
  }

  removeConnectionCallback(callback: ConnectionCallback): void {
    const index = this.connectionCallbacks.indexOf(callback)
    if (index > -1) {
      this.connectionCallbacks.splice(index, 1)
    }
  }

  onDisconnection(callback: DisconnectionCallback): void {
    this.disconnectionCallbacks.push(callback)
  }

  removeDisconnectionCallback(callback: DisconnectionCallback): void {
    const index = this.disconnectionCallbacks.indexOf(callback)
    if (index > -1) {
      this.disconnectionCallbacks.splice(index, 1)
    }
  }

  routeMessage(message: WebSocketMessage): void {
    const callbacks = this.callbacks.get(message.type)
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(message)
        } catch (error) {
          console.error("Error in WebSocket callback:", error)
        }
      })
    }
  }

  notifyConnected(): void {
    this.connectionCallbacks.forEach((cb) => {
      try {
        cb()
      } catch (error) {
        console.error("Error in connection callback:", error)
      }
    })
  }

  notifyDisconnected(event: CloseEvent): void {
    this.disconnectionCallbacks.forEach((cb) => {
      try {
        cb(event)
      } catch (error) {
        console.error("Error in disconnection callback:", error)
      }
    })
  }
}
