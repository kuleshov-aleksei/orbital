import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WebSocketMessage } from "@/types"
import { clearAuthToken, setAuthToken, setTokenExpiry } from "./api"
import { WebSocketService } from "./websocket"
import { setOnClientOutdated, WS_CLOSE_CLIENT_OUTDATED } from "./appVersion"

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
  onclose: ((event: { wasClean: boolean; code?: number }) => void) | null = null
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

  /** Server-initiated close with a code (e.g. 4426 for an outdated app). */
  serverClose(code: number): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ wasClean: true, code })
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

    service.sendGlobalMessage("nickname_change", { user_id: "user-1", nickname: "A" })
    expect(socket.sent).toHaveLength(0)

    socket.open()
    await connected

    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "nickname_change",
      data: { user_id: "user-1", nickname: "A" },
    })
  })

  it("sends media state snapshots in snake_case and replays the latest in join_room", async () => {
    const service = new WebSocketService()
    const connected = service.connect("room-1", "user-1")
    const socket = lastSocket()
    const state = {
      isMuted: true,
      isDeafened: false,
      isScreenSharing: true,
      isCameraEnabled: false,
    }

    // Not open yet: stored, not queued
    service.sendMediaState("room-1", state)
    socket.open()
    await connected

    const join = JSON.parse(socket.sent[0])
    expect(join.type).toBe("join_room")
    expect(join.data.media_state).toEqual({
      is_muted: true,
      is_deafened: false,
      is_screen_sharing: true,
      is_camera_enabled: false,
    })
    expect(socket.sent).toHaveLength(1)

    service.sendMediaState("room-1", { ...state, isCameraEnabled: true })
    expect(JSON.parse(socket.sent[1])).toEqual({
      type: "update_media_state",
      data: {
        room_id: "room-1",
        is_muted: true,
        is_deafened: false,
        is_screen_sharing: true,
        is_camera_enabled: true,
      },
    })

    // Snapshots for another room are ignored
    service.sendMediaState("room-2", state)
    expect(socket.sent).toHaveLength(2)
  })

  it("forgets the media state snapshot after leaving the room", async () => {
    const service = new WebSocketService()
    const first = service.connect("room-1", "user-1")
    lastSocket().open()
    await first
    service.sendMediaState("room-1", {
      isMuted: true,
      isDeafened: true,
      isScreenSharing: false,
      isCameraEnabled: false,
    })
    service.disconnect()

    const second = service.connect("room-1", "user-1")
    lastSocket().open()
    await second

    expect(JSON.parse(lastSocket().sent[0]).data.media_state).toBeUndefined()
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

describe("client_state (mobile push suppression)", () => {
  const states = (socket: FakeWebSocket) =>
    socket.sent
      .map((raw) => JSON.parse(raw) as WebSocketMessage)
      .filter((m) => m.type === "client_state")
      .map((m) => (m.data as { active: boolean }).active)

  // The node test environment stubs document/window with no-op listeners
  // (src/test-setup.ts): capture what the service registers.
  type Handler = () => void
  let docHandlers: Map<string, Handler[]>
  let winHandlers: Map<string, Handler[]>
  const doc = document as unknown as { hidden: boolean }
  const fire = (map: Map<string, Handler[]>, type: string) => map.get(type)?.forEach((h) => h())

  beforeEach(() => {
    docHandlers = new Map()
    winHandlers = new Map()
    const capture = (map: Map<string, Handler[]>) => (type: string, fn: unknown) => {
      map.set(type, [...(map.get(type) ?? []), fn as Handler])
    }
    vi.spyOn(document, "addEventListener").mockImplementation(capture(docHandlers))
    vi.spyOn(window, "addEventListener").mockImplementation(capture(winHandlers))
    doc.hidden = false
  })
  afterEach(() => {
    doc.hidden = false
  })

  async function connectGlobal() {
    const service = new WebSocketService()
    const connected = service.connectGlobal()
    const socket = lastSocket()
    socket.open()
    await connected
    return { service, socket }
  }

  it("ignores focus: a blurred but visible window stays active", async () => {
    const { service, socket } = await connectGlobal()
    expect(winHandlers.has("blur")).toBe(false)
    fire(winHandlers, "blur")
    expect(states(socket)).toEqual([true])
    await service.disconnectGlobal()
  })

  it("goes inactive when hidden or idle, and active again on input", async () => {
    const { service, socket } = await connectGlobal()
    expect(states(socket)).toEqual([true])

    doc.hidden = true
    fire(docHandlers, "visibilitychange")
    expect(states(socket)).toEqual([true, false])

    doc.hidden = false
    fire(docHandlers, "visibilitychange")
    expect(states(socket)).toEqual([true, false, true])

    // Ten minutes without clicks or keys: idle.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(states(socket)).toEqual([true, false, true, false])

    fire(winHandlers, "pointerdown")
    expect(states(socket)).toEqual([true, false, true, false, true])
    await service.disconnectGlobal()
  })
})

describe("outdated app", () => {
  afterEach(() => setOnClientOutdated(null))

  it("stops reconnecting on close code 4426 and reports it", async () => {
    const outdated = vi.fn()
    setOnClientOutdated(outdated)

    const { socket } = await connectService()
    socket.serverClose(WS_CLOSE_CLIENT_OUTDATED)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(outdated).toHaveBeenCalledTimes(1)

    const service = new WebSocketService()
    const connected = service.connectGlobal()
    lastSocket().open()
    await connected
    lastSocket().serverClose(WS_CLOSE_CLIENT_OUTDATED)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(outdated).toHaveBeenCalledTimes(2)
  })

  it("keeps the token in the socket URL and adds no client id on the web", async () => {
    const { socket } = await connectService()
    const url = new URL(socket.url)
    expect(url.searchParams.get("token")).toBe("valid-token")
    expect(url.searchParams.has("client")).toBe(false)
  })
})
