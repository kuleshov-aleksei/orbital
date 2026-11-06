import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WebSocketMessage } from "@/types"
import { clearAuthToken, setAuthToken, setTokenExpiry } from "./api"
import { WebSocketService } from "./websocket"

type Listener = () => void

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { wasClean: boolean }) => void) | null = null
  private listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ wasClean: true })
    this.listeners.get("close")?.forEach((listener) => listener())
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    this.sent.push(data)
  }
}

const lastSocket = (): FakeWebSocket => {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  if (!socket) throw new Error("no socket created")
  return socket
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal("WebSocket", FakeWebSocket)
  setAuthToken("valid-token")
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  clearAuthToken()
})

async function connectService(): Promise<{
  service: WebSocketService
  socket: FakeWebSocket
}> {
  const service = new WebSocketService()
  const connected = service.connect("room-1", "user-1")
  const socket = lastSocket()
  socket.open()
  await connected
  return { service, socket }
}

describe("room reconnection", () => {
  it("backs off exponentially and resets the counter after a successful connect", async () => {
    const { socket } = await connectService()

    socket.close()
    expect(FakeWebSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(199)
    expect(FakeWebSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances).toHaveLength(2)

    // Second attempt waits 400ms (200 * 2^1).
    lastSocket().close()
    await vi.advanceTimersByTimeAsync(399)
    expect(FakeWebSocket.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances).toHaveLength(3)

    // A successful open clears the attempt counter back to 200ms.
    lastSocket().open()
    lastSocket().close()
    await vi.advanceTimersByTimeAsync(199)
    expect(FakeWebSocket.instances).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances).toHaveLength(4)
  })

  it("stops after seven reconnect attempts", async () => {
    await connectService()

    for (let attempt = 0; attempt < 7; attempt += 1) {
      lastSocket().close()
      await vi.advanceTimersByTimeAsync(200 * 2 ** attempt)
    }

    expect(FakeWebSocket.instances).toHaveLength(8)

    lastSocket().close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances).toHaveLength(8)
  })

  it("does not reconnect without a valid session", async () => {
    clearAuthToken()
    const { socket } = await connectService()
    socket.close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)

    // An expired token is just as useless — the handshake would be rejected.
    setAuthToken("expired-token")
    setTokenExpiry(new Date(Date.now() - 60_000).toISOString())
    const expired = new WebSocketService()
    const connected = expired.connect("room-2", "user-1")
    lastSocket().open()
    await connected
    lastSocket().close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })
})

describe("global reconnection", () => {
  it("does not reconnect after a deliberate close", async () => {
    const service = new WebSocketService()
    const connected = service.connectGlobal()
    lastSocket().open()
    await connected

    await service.disconnectGlobal()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})

describe("outbound buffering", () => {
  it("queues room messages while connecting and flushes them after join_room", async () => {
    const service = new WebSocketService()
    const connected = service.connect("room-1", "user-1")
    const socket = lastSocket()

    service.sendMessage("send_message", { content: "hello" })
    service.sendMessage("send_message", { content: "world" })
    service.sendMessage("ping", { user_id: "user-1" })
    expect(socket.sent).toHaveLength(0)

    socket.open()
    await connected

    expect(socket.sent.map((raw) => JSON.parse(raw).type)).toEqual([
      "join_room",
      "send_message",
      "send_message",
    ])
  })

  it("queues global messages while connecting and flushes them on open", async () => {
    const service = new WebSocketService()
    const connected = service.connectGlobal()
    const socket = lastSocket()

    service.sendGlobalMessage("update_mute_state", { room_id: "room-1", is_muted: true })
    expect(socket.sent).toHaveLength(0)

    socket.open()
    await connected

    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "update_mute_state",
      data: { room_id: "room-1", is_muted: true },
    })
  })

  it("drops buffered messages when leaving the room", async () => {
    const service = new WebSocketService()
    service.sendMessage("send_message", { content: "stale" })
    service.disconnect()

    const connected = service.connect("room-1", "user-1")
    lastSocket().open()
    await connected

    expect(lastSocket().sent.map((raw) => JSON.parse(raw).type)).toEqual(["join_room"])
  })
})

describe("message routing", () => {
  it("isolates throwing callbacks, ignores malformed payloads, and supports off()", () => {
    const service = new WebSocketService()
    const received: WebSocketMessage[] = []
    const handle = (
      service as unknown as { handleMessage: (event: { data: string }) => void }
    ).handleMessage.bind(service)

    service.on("new_message", () => {
      throw new Error("callback exploded")
    })
    service.on("new_message", (message) => received.push(message))

    handle({ data: JSON.stringify({ type: "new_message", data: { id: "m1" } }) })
    expect(received).toEqual([{ type: "new_message", data: { id: "m1" } }])

    received.length = 0
    handle({ data: "not-json" })
    expect(received).toHaveLength(0)

    service.off("new_message")
    handle({ data: JSON.stringify({ type: "new_message", data: { id: "m2" } }) })
    expect(received).toHaveLength(0)
  })
})
