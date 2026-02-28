import { useDebugSettingsStore } from "@/stores/debugSettings"

const MAX_BUFFER_SIZE = 1000

interface LogEntry {
  message: string
  level: "log" | "warn" | "error"
  timestamp: Date
}

class CircularLinkedList {
  private buffer: (LogEntry | null)[]
  private head: number = 0
  private tail: number = 0
  private size: number = 0
  private capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Array(capacity).fill(null)
  }

  push(entry: LogEntry): void {
    this.buffer[this.tail] = entry
    this.tail = (this.tail + 1) % this.capacity

    if (this.size === this.capacity) {
      this.head = (this.head + 1) % this.capacity
    } else {
      this.size++
    }
  }

  toArray(): LogEntry[] {
    const result: LogEntry[] = []
    let index = this.head

    for (let i = 0; i < this.size; i++) {
      const entry = this.buffer[index]
      if (entry) {
        result.push(entry)
      }
      index = (index + 1) % this.capacity
    }

    return result
  }

  clear(): void {
    this.buffer.fill(null)
    this.head = 0
    this.tail = 0
    this.size = 0
  }

  getSize(): number {
    return this.size
  }
}

const logBuffer = new CircularLinkedList(MAX_BUFFER_SIZE)

function formatLogMessage(level: string, message: string, optionalParams: unknown[]): string {
  const timestamp = new Date().toISOString()
  const paramsStr =
    optionalParams.length > 0
      ? " " +
        optionalParams
          .map((p) => {
            if (typeof p === "object") {
              try {
                return JSON.stringify(p)
              } catch {
                return String(p)
              }
            }
            return String(p)
          })
          .join(" ")
      : ""

  return `[${timestamp}] [${level.toUpperCase()}] ${message}${paramsStr}`
}

function storeInBuffer(
  level: "log" | "warn" | "error",
  message: string,
  optionalParams: unknown[],
): void {
  const formattedMessage = formatLogMessage(level, message, optionalParams)
  logBuffer.push({
    message: formattedMessage,
    level,
    timestamp: new Date(),
  })
}

export function getLogBuffer(): LogEntry[] {
  return logBuffer.toArray()
}

export function clearLogBuffer(): void {
  logBuffer.clear()
}

export function getLogBufferSize(): number {
  return logBuffer.getSize()
}

export function debugError(message: string, ...optionalParams: unknown[]): void {
  storeInBuffer("error", message, optionalParams)
  console.error(message, ...optionalParams)
}

export function debugLog(message: string, ...optionalParams: unknown[]): void {
  const debugStore = useDebugSettingsStore()
  storeInBuffer("log", message, optionalParams)

  if (debugStore.isDebugLogsEnabled) {
    console.log(message, ...optionalParams)
  }
}

export function debugWarn(message: string, ...optionalParams: unknown[]): void {
  const debugStore = useDebugSettingsStore()
  storeInBuffer("warn", message, optionalParams)

  if (debugStore.isDebugLogsEnabled) {
    console.warn(message, ...optionalParams)
  }
}
