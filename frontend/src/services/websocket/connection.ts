import { getAuthToken } from "@/services/api"

declare const __BACKEND_WS_URL__: string | undefined

export type ConnectionEventListener = () => void
export type DisconnectionEventListener = (event: CloseEvent) => void
export type MessageEventListener = (event: MessageEvent<unknown>) => void

export interface WebSocketConnectionOptions {
  roomId?: string
  isGlobal?: boolean
}

export class WebSocketConnection {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 7
  private reconnectDelay = 200
  private roomId = ""
  private isGlobal = false
  private connectionPromise: Promise<void> | null = null

  onMessage: MessageEventListener | null = null
  onConnected: ConnectionEventListener | null = null
  onDisconnected: DisconnectionEventListener | null = null

  connect(roomIdOrOptions?: string | WebSocketConnectionOptions): Promise<void> {
    if (typeof roomIdOrOptions === "string") {
      this.roomId = roomIdOrOptions
      this.isGlobal = false
    } else if (roomIdOrOptions) {
      this.roomId = roomIdOrOptions.roomId || ""
      this.isGlobal = roomIdOrOptions.isGlobal || false
    }

    if (this.connectionPromise) {
      return this.connectionPromise
    }

    if (this.isConnected()) {
      return Promise.resolve()
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      try {
        const wsUrl = this.getUrl()
        this.ws = new WebSocket(wsUrl)

        this.ws.onopen = () => {
          this.reconnectAttempts = 0
          this.connectionPromise = null
          this.onConnected?.()
          resolve()
        }

        this.ws.onerror = () => {
          this.connectionPromise = null
          reject(new Error("WebSocket connection failed"))
        }

        this.ws.onmessage = (event) => {
          this.onMessage?.(event)
        }

        this.ws.onclose = (event) => {
          this.connectionPromise = null
          this.onDisconnected?.(event)
          this.attemptReconnect()
        }
      } catch (error) {
        this.connectionPromise = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

    return this.connectionPromise
  }

  disconnect(): void {
    this.reconnectAttempts = this.maxReconnectAttempts
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  async disconnectGraceful(): Promise<void> {
    if (this.connectionPromise) {
      try {
        await this.connectionPromise
      } catch {
        // Connection failed during disconnect, that's fine
      }
    }

    if (this.ws) {
      await new Promise<void>((resolve) => {
        if (this.ws!.readyState === WebSocket.CLOSED) {
          resolve()
          return
        }

        const onClose = () => resolve()
        this.ws!.addEventListener("close", onClose, { once: true })
        this.ws!.close()

        setTimeout(() => {
          this.ws!.removeEventListener("close", onClose)
          resolve()
        }, 1000)
      })

      this.ws = null
    }
  }

  send(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  getReadyState(): number {
    return this.ws ? this.ws.readyState : WebSocket.CLOSED
  }

  private getUrl(): string {
    const wsUrlFromEnv = typeof __BACKEND_WS_URL__ !== "undefined" ? __BACKEND_WS_URL__ : null
    const token = getAuthToken()
    let baseUrl: string

    if (wsUrlFromEnv) {
      baseUrl = this.isGlobal ? `${wsUrlFromEnv}/ws` : `${wsUrlFromEnv}/ws/${this.roomId}`
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      baseUrl = this.isGlobal
        ? `${protocol}//${window.location.host}/ws`
        : `${protocol}//${window.location.host}/ws/${this.roomId}`
    }

    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return
    }

    if (!this.isGlobal && !this.roomId) {
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)

    setTimeout(() => {
      this.connect().catch(() => undefined)
    }, delay)
  }
}
