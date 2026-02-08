import { WebSocketMessage } from '@/types'
import { getAuthToken } from './api'

export type MessageCallback = (message: WebSocketMessage) => void
export type ConnectionCallback = () => void
export type DisconnectionCallback = (event: CloseEvent) => void

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
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private roomId: string = ''
  private userId: string = ''
  private globalConnectionPromise: Promise<void> | null = null

  constructor() {
    this.setupEventHandlers()
  }

  // Connect to WebSocket for a room
  async connect(roomId: string, userId: string): Promise<void> {
    this.roomId = roomId
    this.userId = userId

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.getWebSocketUrl(roomId)
        console.log(`Connecting to WebSocket: ${wsUrl}`)
        
        this.ws = new WebSocket(wsUrl)
        
        this.ws.onopen = (event) => {
          console.log('WebSocket connected:', event)
          this.reconnectAttempts = 0
          
          // Send join_room message when connected
          this.sendMessage('join_room', {
            room_id: this.roomId,
            user_id: this.userId,
            nickname: localStorage.getItem('orbital_user_nickname') || `User_${this.userId.substr(0, 8)}`
          })
          
          this.notifyConnectionCallbacks()
          resolve()
        }

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error)
          reject(new Error('WebSocket connection failed'))
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event)
        }

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', event)
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
    // If already connecting, return the existing promise
    if (this.globalConnectionPromise) {
      console.log('Global WebSocket connection already in progress, waiting...')
      return this.globalConnectionPromise
    }

    // If already connected, resolve immediately
    if (this.isGlobalConnected()) {
      console.log('Global WebSocket already connected')
      return Promise.resolve()
    }

    this.globalConnectionPromise = new Promise((resolve, reject) => {
      try {
        const wsUrl = this.getGlobalWebSocketUrl()
        console.log(`Connecting to global WebSocket: ${wsUrl}`)

        this.globalWs = new WebSocket(wsUrl)

        this.globalWs.onopen = (event) => {
          console.log('Global WebSocket connected:', event)
          this.globalConnectionPromise = null
          this.notifyGlobalConnectionCallbacks()
          resolve()
        }

        this.globalWs.onerror = (error) => {
          console.error('Global WebSocket error:', error)
          this.globalConnectionPromise = null
          reject(new Error('Global WebSocket connection failed'))
        }

        this.globalWs.onmessage = (event) => {
          this.handleGlobalMessage(event)
        }

        this.globalWs.onclose = (event) => {
          console.log('Global WebSocket closed:', event)
          this.globalConnectionPromise = null
          this.notifyGlobalDisconnectionCallbacks(event)
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
    if (this.ws) {
      this.reconnectAttempts = this.maxReconnectAttempts // Prevent reconnection
      this.ws.close()
      this.ws = null
    }
  }

  // Disconnect from global WebSocket
  async disconnectGlobal(): Promise<void> {
    // If connection is in progress, wait for it to complete or fail
    if (this.globalConnectionPromise) {
      try {
        await this.globalConnectionPromise
      } catch {
        // Connection failed, that's fine
      }
    }

    if (this.globalWs) {
      // Wait for the close event before resolving
      await new Promise<void>((resolve) => {
        if (!this.globalWs || this.globalWs.readyState === WebSocket.CLOSED) {
          resolve()
          return
        }

        const onClose = () => {
          resolve()
        }

        this.globalWs.addEventListener('close', onClose, { once: true })
        this.globalWs.close()

        // Timeout after 1 second to prevent hanging
        setTimeout(() => {
          this.globalWs?.removeEventListener('close', onClose)
          resolve()
        }, 1000)
      })

      this.globalWs = null
    }
  }

  // Send message to WebSocket
  sendMessage(type: WebSocketMessage['type'], data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message: WebSocketMessage = { type, data }
      this.ws.send(JSON.stringify(message))

      if (message.type !== 'ping') {
        console.log('Sent WebSocket message:', message)
      }
    } else {
      console.warn('WebSocket not connected, cannot send message:', { type, data })
    }
  }

  // Send message to global WebSocket
  sendGlobalMessage(type: WebSocketMessage['type'], data: unknown): void {
    if (this.globalWs && this.globalWs.readyState === WebSocket.OPEN) {
      const message: WebSocketMessage = { type, data }
      this.globalWs.send(JSON.stringify(message))

      if (message.type !== 'ping') {
        console.log('Sent global WebSocket message:', message)
      }
    } else {
      console.warn('Global WebSocket not connected, cannot send message:', { type, data })
    }
  }

  // Send nickname change message via global WebSocket
  changeNickname(userId: string, nickname: string): void {
    this.sendGlobalMessage('nickname_change', {
      user_id: userId,
      nickname: nickname
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

  // Remove callback for specific type
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

  // Private methods
  private getWebSocketUrl(roomId: string): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const token = getAuthToken()
    const baseUrl = `${protocol}//${window.location.host}/ws/${roomId}`
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
  }

  private getGlobalWebSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const token = getAuthToken()
    const baseUrl = `${protocol}//${window.location.host}/ws`
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
  }

  private handleMessage(event: MessageEvent<unknown>): void {
    try {
      const message = JSON.parse(event.data as string) as WebSocketMessage
      if (message.type !== 'pong') {
        console.log('Received WebSocket message:', message)
      }

      // Route message to appropriate callbacks
      const callbacks = this.callbacks.get(message.type)
      if (callbacks) {
        callbacks.forEach(callback => {
          try {
            callback(message)
          } catch (error) {
            console.error('Error in WebSocket callback:', error)
          }
        })
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error, event.data)
    }
  }

  private notifyConnectionCallbacks(): void {
    this.connectionCallbacks.forEach(callback => {
      try {
        callback()
      } catch (error) {
        console.error('Error in connection callback:', error)
      }
    })
  }

  private notifyDisconnectionCallbacks(event: CloseEvent): void {
    this.disconnectionCallbacks.forEach(callback => {
      try {
        callback(event)
      } catch (error) {
        console.error('Error in disconnection callback:', error)
      }
    })
  }

  private notifyGlobalConnectionCallbacks(): void {
    this.globalConnectionCallbacks.forEach(callback => {
      try {
        callback()
      } catch (error) {
        console.error('Error in global connection callback:', error)
      }
    })
  }

  private notifyGlobalDisconnectionCallbacks(event: CloseEvent): void {
    this.globalDisconnectionCallbacks.forEach(callback => {
      try {
        callback(event)
      } catch (error) {
        console.error('Error in global disconnection callback:', error)
      }
    })
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnection attempts reached')
      return
    }

    // Don't attempt room reconnection if not in a room
    if (!this.roomId) {
      console.log('No active room, skipping room WebSocket reconnection')
      return
    }

    this.reconnectAttempts++
    console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    setTimeout(() => {
      this.connect(this.roomId, this.userId).catch(error => {
        console.error('Reconnection failed:', error)
      })
    }, this.reconnectDelay * this.reconnectAttempts)
  }

  private handleGlobalMessage(event: MessageEvent<unknown>): void {
    try {
      const message = JSON.parse(event.data as string) as WebSocketMessage
      console.log('Received global WebSocket message:', message)

      // Route message to appropriate global callbacks
      const callbacks = this.globalCallbacks.get(message.type)
      if (callbacks) {
        callbacks.forEach(callback => {
          try {
            callback(message)
          } catch (error) {
            console.error('Error in global WebSocket callback:', error)
          }
        })
      }
    } catch (error) {
      console.error('Error parsing global WebSocket message:', error, event.data)
    }
  }

  private setupEventHandlers(): void {
    // Handle page visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Page is hidden, consider pausing some operations
        console.log('Page hidden, WebSocket still connected')
      } else {
        // Page is visible, check connection
        if (!this.isConnected() && this.roomId) {
          console.log('Page visible, attempting to reconnect')
          this.attemptReconnect()
        }
        if (!this.isGlobalConnected()) {
          console.log('Page visible, attempting to reconnect global WebSocket')
          this.connectGlobal().catch(error => {
            console.error('Failed to reconnect global WebSocket:', error)
          })
        }
      }
    })

    // Handle browser close
    window.addEventListener('beforeunload', () => {
      this.disconnect()
      void this.disconnectGlobal()
    })
  }
}

// Singleton instance
export const wsService = new WebSocketService()