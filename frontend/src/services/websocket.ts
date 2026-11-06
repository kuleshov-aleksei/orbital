import { WebSocketMessage } from "@/types"
import { getAuthToken, isTokenExpired } from "./api"

declare const __BACKEND_WS_URL__: string | undefined

export type MessageCallback = (message: WebSocketMessage) => void
export type ConnectionCallback = () => void
export type DisconnectionCallback = (event: CloseEvent) => void

// Full presence snapshot of the local user, sent to the backend room member
export interface LocalMediaState {
  isMuted: boolean
  isDeafened: boolean
  isScreenSharing: boolean
  isCameraEnabled: boolean
}

function toMediaStatePayload(state: LocalMediaState) {
  return {
    is_muted: state.isMuted,
    is_deafened: state.isDeafened,
    is_screen_sharing: state.isScreenSharing,
    is_camera_enabled: state.isCameraEnabled,
  }
}

// Upper bound on buffered outbound messages — a long outage must not grow
// memory without limit. Oldest messages are dropped first.
const MAX_QUEUED_MESSAGES = 100

export class WebSocketService {
  private ws: WebSocket | null = null
  private globalWs: WebSocket | null = null
  private callbacks: Map<string, MessageCallback[]> = new Map()
  private globalCallbacks: Map<string, MessageCallback[]> = new Map()
  private connectionCallbacks: ConnectionCallback[] = []
  private disconnectionCallbacks: DisconnectionCallback[] = []
  private globalConnectionCallbacks: ConnectionCallback[] = []
  private globalDisconnectionCallbacks: DisconnectionCallback[] = []
  private reconnectAttempts = 0
  private maxReconnectAttempts = 7
  private reconnectDelay = 200
  private globalReconnectAttempts = 0
  private maxGlobalReconnectAttempts = 7
  private globalReconnectDelay = 200
  private roomId: string = ""
  private userId: string = ""
  private globalConnectionPromise: Promise<void> | null = null
  // Set while closing the global socket on purpose so onclose does not kick off
  // a reconnect loop (e.g. on session expiry / logout).
  private globalManualClose = false
  // Messages written while the socket is (re)connecting are buffered instead of
  // dropped. Pings are never buffered — a keepalive sent late is meaningless.
  private roomQueue: WebSocketMessage[] = []
  private globalQueue: WebSocketMessage[] = []
  // Last media state snapshot; re-sent inside join_room on every (re)connect so
  // the backend member never starts from stale defaults.
  private lastMediaState: LocalMediaState | null = null

  constructor() {
    this.setupEventHandlers()
  }

  // Connect to WebSocket for a room
  async connect(roomId: string, userId: string, deviceInfo?: string): Promise<void> {
    // Anything queued for a different room must not leak into this session.
    if (this.roomId && this.roomId !== roomId) {
      this.roomQueue = []
      this.lastMediaState = null
    }
    this.roomId = roomId
    this.userId = userId

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.getWebSocketUrl(roomId)
        console.log(`Connecting to WebSocket: ${wsUrl.substring(0, wsUrl.indexOf("?"))}`)

        this.ws = new WebSocket(wsUrl)

        this.ws.onopen = (event) => {
          console.log("WebSocket connected:", event)
          this.reconnectAttempts = 0

          // Send join_room message when connected
          this.sendMessage("join_room", {
            room_id: this.roomId,
            user_id: this.userId,
            nickname:
              localStorage.getItem("orbital_user_nickname") || `User_${this.userId.substr(0, 8)}`,
            ...(deviceInfo ? { device_info: deviceInfo } : {}),
            ...(this.lastMediaState
              ? { media_state: toMediaStatePayload(this.lastMediaState) }
              : {}),
          })

          // join_room stays first; buffered messages follow in order.
          this.flushQueue(this.ws, this.roomQueue, "WebSocket")

          this.notifyConnectionCallbacks()
          resolve()
        }

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error)
          reject(new Error("WebSocket connection failed"))
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event)
        }

        this.ws.onclose = (event) => {
          console.log("WebSocket closed:", event)
          this.notifyDisconnectionCallbacks(event)
          this.attemptReconnect()
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  // Connect to global WebSocket for broadcasts
  async connectGlobal(): Promise<void> {
    // Any explicit connect clears a pending manual-close marker.
    this.globalManualClose = false

    // If already connecting, return the existing promise
    if (this.globalConnectionPromise) {
      console.log("Global WebSocket connection already in progress, waiting...")
      return this.globalConnectionPromise
    }

    // If already connected, resolve immediately
    if (this.isGlobalConnected()) {
      console.log("Global WebSocket already connected")
      return Promise.resolve()
    }

    this.globalConnectionPromise = new Promise((resolve, reject) => {
      try {
        const wsUrl = this.getGlobalWebSocketUrl()
        console.log(`Connecting to global WebSocket: ${wsUrl.substring(0, wsUrl.indexOf("?"))}`)

        this.globalWs = new WebSocket(wsUrl)

        this.globalWs.onopen = (event) => {
          console.log("Global WebSocket connected:", event)
          this.globalConnectionPromise = null
          this.globalReconnectAttempts = 0
          this.flushQueue(this.globalWs, this.globalQueue, "global WebSocket")
          this.notifyGlobalConnectionCallbacks()
          resolve()
        }

        this.globalWs.onerror = (error) => {
          console.error("Global WebSocket error:", error)
          this.globalConnectionPromise = null
          reject(new Error("Global WebSocket connection failed"))
        }

        this.globalWs.onmessage = (event) => {
          this.handleGlobalMessage(event)
        }

        this.globalWs.onclose = (event) => {
          console.log("Global WebSocket closed:", event)
          this.globalConnectionPromise = null
          this.notifyGlobalDisconnectionCallbacks(event)
          if (this.globalManualClose) {
            this.globalManualClose = false
            return
          }
          this.attemptGlobalReconnect()
        }
      } catch (error) {
        this.globalConnectionPromise = null
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

    return this.globalConnectionPromise
  }

  // Disconnect from WebSocket
  disconnect(): void {
    // Leaving the room drops anything that was waiting for the connection.
    this.roomQueue = []
    this.lastMediaState = null
    if (this.ws) {
      this.reconnectAttempts = this.maxReconnectAttempts // Prevent reconnection
      this.ws.close()
      this.ws = null
    }
  }

  // Disconnect from global WebSocket
  async disconnectGlobal(): Promise<void> {
    this.globalQueue = []
    // If connection is in progress, wait for it to complete or fail
    if (this.globalConnectionPromise) {
      try {
        await this.globalConnectionPromise
      } catch {
        // Connection failed, that's fine
      }
    }

    if (this.globalWs) {
      // Mark as a deliberate close so onclose does not schedule a reconnect.
      this.globalManualClose = true
      // Wait for the close event before resolving
      await new Promise<void>((resolve) => {
        if (!this.globalWs || this.globalWs.readyState === WebSocket.CLOSED) {
          resolve()
          return
        }

        const onClose = () => {
          resolve()
        }

        this.globalWs.addEventListener("close", onClose, { once: true })
        this.globalWs.close()

        // Timeout after 1 second to prevent hanging
        setTimeout(() => {
          this.globalWs?.removeEventListener("close", onClose)
          resolve()
        }, 1000)
      })

      this.globalWs = null
    }
  }

  // Send message to WebSocket
  sendMessage(type: WebSocketMessage["type"], data: unknown): void {
    const message: WebSocketMessage = { type, data }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.writeToSocket(this.ws, message, "WebSocket")
      return
    }

    if (type === "ping") {
      console.warn("WebSocket not connected, skipping ping")
      return
    }

    this.roomQueue.push(message)
    if (this.roomQueue.length > MAX_QUEUED_MESSAGES) {
      this.roomQueue.shift()
    }
    console.warn("WebSocket not connected, queued message:", type)
  }

  // Send message to global WebSocket
  sendGlobalMessage(type: WebSocketMessage["type"], data: unknown): void {
    const message: WebSocketMessage = { type, data }

    if (this.globalWs && this.globalWs.readyState === WebSocket.OPEN) {
      this.writeToSocket(this.globalWs, message, "global WebSocket")
      return
    }

    if (type === "ping") {
      console.warn("Global WebSocket not connected, skipping ping")
      return
    }

    this.globalQueue.push(message)
    if (this.globalQueue.length > MAX_QUEUED_MESSAGES) {
      this.globalQueue.shift()
    }
    console.warn("Global WebSocket not connected, queued message:", type)
  }

  private writeToSocket(socket: WebSocket, message: WebSocketMessage, label: string): void {
    socket.send(JSON.stringify(message))

    if (message.type !== "ping") {
      console.log(`Sent ${label} message:`, message)
    }
  }

  // Flush buffered messages once the socket is open, preserving send order.
  private flushQueue(socket: WebSocket | null, queue: WebSocketMessage[], label: string): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return

    while (queue.length > 0) {
      const message = queue.shift()
      if (message) {
        this.writeToSocket(socket, message, label)
      }
    }
  }

  // Send nickname change message via global WebSocket
  changeNickname(userId: string, nickname: string): void {
    this.sendGlobalMessage("nickname_change", {
      user_id: userId,
      nickname: nickname,
    })
  }

  // Register callback for specific message type
  on(type: string, callback: MessageCallback): void {
    if (!this.callbacks.has(type)) {
      this.callbacks.set(type, [])
    }
    this.callbacks.get(type)!.push(callback)
  }

  // Register callback for specific global message type
  onGlobal(type: string, callback: MessageCallback): void {
    if (!this.globalCallbacks.has(type)) {
      this.globalCallbacks.set(type, [])
    }
    this.globalCallbacks.get(type)!.push(callback)
  }

  // Register connection callback
  onConnection(callback: ConnectionCallback): void {
    this.connectionCallbacks.push(callback)
  }

  // Register disconnection callback
  onDisconnection(callback: DisconnectionCallback): void {
    this.disconnectionCallbacks.push(callback)
  }

  // Register global connection callback
  onGlobalConnection(callback: ConnectionCallback): void {
    this.globalConnectionCallbacks.push(callback)
  }

  // Register global disconnection callback
  onGlobalDisconnection(callback: DisconnectionCallback): void {
    this.globalDisconnectionCallbacks.push(callback)
  }

  // Remove callback for specific type (room WS)
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

  // Remove callback for specific type (global WS)
  offGlobal(type: string, callback?: MessageCallback): void {
    if (callback) {
      const callbacks = this.globalCallbacks.get(type)
      if (callbacks) {
        const index = callbacks.indexOf(callback)
        if (index > -1) {
          callbacks.splice(index, 1)
        }
      }
    } else {
      this.globalCallbacks.delete(type)
    }
  }

  // Remove connection callbacks
  removeConnectionCallback(callback: ConnectionCallback): void {
    const index = this.connectionCallbacks.indexOf(callback)
    if (index > -1) {
      this.connectionCallbacks.splice(index, 1)
    }
  }

  // Remove disconnection callbacks
  removeDisconnectionCallback(callback: DisconnectionCallback): void {
    const index = this.disconnectionCallbacks.indexOf(callback)
    if (index > -1) {
      this.disconnectionCallbacks.splice(index, 1)
    }
  }

  // Remove global connection callbacks
  removeGlobalConnectionCallback(callback: ConnectionCallback): void {
    const index = this.globalConnectionCallbacks.indexOf(callback)
    if (index > -1) {
      this.globalConnectionCallbacks.splice(index, 1)
    }
  }

  // Remove global disconnection callbacks
  removeGlobalDisconnectionCallback(callback: DisconnectionCallback): void {
    const index = this.globalDisconnectionCallbacks.indexOf(callback)
    if (index > -1) {
      this.globalDisconnectionCallbacks.splice(index, 1)
    }
  }

  // Get connection status
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  // Get global connection status
  isGlobalConnected(): boolean {
    return this.globalWs !== null && this.globalWs.readyState === WebSocket.OPEN
  }

  // Get connection state
  getReadyState(): number {
    return this.ws ? this.ws.readyState : WebSocket.CLOSED
  }

  // Get global connection state
  getGlobalReadyState(): number {
    return this.globalWs ? this.globalWs.readyState : WebSocket.CLOSED
  }

  // Send the full media state snapshot over the room WebSocket. The room
  // socket is ordered after join_room, so the backend always has the member
  // before the update arrives (the global socket would race the join).
  sendMediaState(roomId: string, state: LocalMediaState): void {
    if (!this.ws || roomId !== this.roomId) return
    this.lastMediaState = { ...state }
    // Not open (connecting/reconnecting): don't queue. join_room on (re)connect
    // carries lastMediaState, so only the latest snapshot ever reaches the server.
    if (this.ws.readyState !== WebSocket.OPEN) return
    this.sendMessage("update_media_state", { room_id: roomId, ...toMediaStatePayload(state) })
  }

  // Send chat message
  sendChatMessage(content: string): void {
    this.sendMessage("send_message", { content })
  }

  // Private methods
  private getWebSocketUrl(roomId: string): string {
    const wsUrlFromEnv = typeof __BACKEND_WS_URL__ !== "undefined" ? __BACKEND_WS_URL__ : null
    if (wsUrlFromEnv) {
      const token = getAuthToken()
      const baseUrl = `${wsUrlFromEnv}/ws/${roomId}`
      return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const token = getAuthToken()
    const baseUrl = `${protocol}//${window.location.host}/ws/${roomId}`
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
  }

  private getGlobalWebSocketUrl(): string {
    const wsUrlFromEnv = typeof __BACKEND_WS_URL__ !== "undefined" ? __BACKEND_WS_URL__ : null
    if (wsUrlFromEnv) {
      const token = getAuthToken()
      const baseUrl = `${wsUrlFromEnv}/ws`
      return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const token = getAuthToken()
    const baseUrl = `${protocol}//${window.location.host}/ws`
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
  }

  private handleMessage(event: MessageEvent<unknown>): void {
    try {
      const message = JSON.parse(event.data as string) as WebSocketMessage
      if (message.type !== "pong") {
        console.log("Received WebSocket message:", message)
      }

      // Route message to appropriate callbacks
      const callbacks = this.callbacks.get(message.type)
      if (callbacks) {
        callbacks.forEach((callback) => {
          try {
            callback(message)
          } catch (error) {
            console.error("Error in WebSocket callback:", error)
          }
        })
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error, event.data)
    }
  }

  private notifyConnectionCallbacks(): void {
    this.connectionCallbacks.forEach((callback) => {
      try {
        callback()
      } catch (error) {
        console.error("Error in connection callback:", error)
      }
    })
  }

  private notifyDisconnectionCallbacks(event: CloseEvent): void {
    this.disconnectionCallbacks.forEach((callback) => {
      try {
        callback(event)
      } catch (error) {
        console.error("Error in disconnection callback:", error)
      }
    })
  }

  private notifyGlobalConnectionCallbacks(): void {
    this.globalConnectionCallbacks.forEach((callback) => {
      try {
        callback()
      } catch (error) {
        console.error("Error in global connection callback:", error)
      }
    })
  }

  private notifyGlobalDisconnectionCallbacks(event: CloseEvent): void {
    this.globalDisconnectionCallbacks.forEach((callback) => {
      try {
        callback(event)
      } catch (error) {
        console.error("Error in global disconnection callback:", error)
      }
    })
  }

  private attemptReconnect(): void {
    // Without a valid session the server rejects the handshake; the auth
    // lifecycle reconnects after a successful sign-in instead.
    if (!getAuthToken() || isTokenExpired()) {
      console.log("No valid auth token, skipping room WebSocket reconnection")
      return
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("Max reconnection attempts reached")
      return
    }

    // Don't attempt room reconnection if not in a room
    if (!this.roomId) {
      console.log("No active room, skipping room WebSocket reconnection")
      return
    }

    this.reconnectAttempts++
    console.log(
      `Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    )

    setTimeout(
      () => {
        this.connect(this.roomId, this.userId).catch((error) => {
          console.error("Reconnection failed:", error)
        })
      },
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
    )
  }

  private attemptGlobalReconnect(): void {
    // Without a valid session the server rejects the handshake; the auth
    // lifecycle reconnects after a successful sign-in instead.
    if (!getAuthToken() || isTokenExpired()) {
      console.log("No valid auth token, skipping global WebSocket reconnection")
      return
    }

    if (this.globalReconnectAttempts >= this.maxGlobalReconnectAttempts) {
      console.log("Max global WebSocket reconnection attempts reached")
      return
    }

    this.globalReconnectAttempts++
    console.log(
      `Attempting to reconnect global WebSocket... (${this.globalReconnectAttempts}/${this.maxGlobalReconnectAttempts})`,
    )

    setTimeout(
      () => {
        this.connectGlobal().catch((error) => {
          console.error("Global reconnection failed:", error)
        })
      },
      this.globalReconnectDelay * Math.pow(2, this.globalReconnectAttempts - 1),
    )
  }

  private handleGlobalMessage(event: MessageEvent<unknown>): void {
    try {
      const message = JSON.parse(event.data as string) as WebSocketMessage
      console.log("Received global WebSocket message:", message)

      // Route message to appropriate global callbacks
      const callbacks = this.globalCallbacks.get(message.type)
      if (callbacks) {
        callbacks.forEach((callback) => {
          try {
            callback(message)
          } catch (error) {
            console.error("Error in global WebSocket callback:", error)
          }
        })
      }
    } catch (error) {
      console.error("Error parsing global WebSocket message:", error, event.data)
    }
  }

  private setupEventHandlers(): void {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        // Never reconnect with a stale token: the server rejects it and we'd
        // just retry forever. The session lifecycle handles re-auth instead.
        if (isTokenExpired()) return
        if (!this.isConnected() && this.roomId) {
          this.attemptReconnect()
        }
        if (!this.isGlobalConnected()) {
          this.connectGlobal().catch((error) => {
            console.error("Failed to reconnect global WebSocket:", error)
          })
        }
      }
    })
  }
}

// Singleton instance
export const wsService = new WebSocketService()
