import { beforeEach, vi } from "vitest"

// Unit tests run in the `node` environment, but several frontend modules touch
// browser globals at import time (WebSocketService's constructor registers a
// `visibilitychange` listener, audio stores read localStorage, etc.). Provide
// just enough of the platform so those modules can be imported and exercised.

class MemoryStorage implements Storage {
  private data = new Map<string, string>()

  get length(): number {
    return this.data.size
  }

  clear(): void {
    this.data.clear()
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value))
  }
}

const storage = new MemoryStorage()

const documentStub = {
  hidden: false,
  activeElement: null,
  body: {},
  head: {},
  documentElement: {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  // @vue/runtime-dom touches this at import time; nothing in these tests renders.
  createElement: () => ({ innerHTML: "", content: { firstChild: null }, style: {} }),
  createElementNS: () => ({ innerHTML: "", content: { firstChild: null }, style: {} }),
  createTextNode: () => ({}),
  createComment: () => ({}),
  querySelector: () => null,
}

const windowStub = {
  location: {
    protocol: "http:",
    host: "localhost:3000",
    href: "http://localhost:3000/",
  },
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  screen: { width: 1920, height: 1080, colorDepth: 24 },
  trustedTypes: undefined,
  addEventListener: () => {},
  removeEventListener: () => {},
}

vi.stubGlobal("localStorage", storage)
vi.stubGlobal("document", documentStub)
vi.stubGlobal("window", windowStub)

// Logs are intentionally chatty in these modules. Keep test output readable;
// individual tests can still assert on behavior instead of console calls.
beforeEach(() => {
  storage.clear()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})
