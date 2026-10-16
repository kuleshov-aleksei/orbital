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

// Error message/stack live on the prototype (non-enumerable), so plain
// JSON.stringify(new Error("x")) yields "{}". Format errors explicitly so
// logs carry the actual failure instead of an empty object.
function formatError(error: Error): string {
  const name = error.name || "Error"
  const message = error.message ? `: ${error.message}` : ""
  let extra = ""
  try {
    const ownProps: Record<string, unknown> = {}
    for (const key of Object.keys(error)) {
      ownProps[key] = (error as unknown as Record<string, unknown>)[key]
    }
    // `cause` is installed as non-enumerable, so pick it up explicitly.
    const cause = (error as { cause?: unknown }).cause
    if (cause !== undefined) {
      ownProps["cause"] = cause instanceof Error ? formatError(cause) : cause
    }
    if (Object.keys(ownProps).length > 0) {
      extra = ` ${JSON.stringify(ownProps)}`
    }
  } catch {
    // Ignore serialization of extra props; name/message/stack still log.
  }
  const stack = error.stack ? `\n${error.stack}` : ""
  return `${name}${message}${extra}${stack}`
}

function formatParam(p: unknown): string {
  if (p instanceof Error) {
    return formatError(p)
  }
  if (typeof p === "object" && p !== null) {
    // Error-like rejection reasons that aren't Error instances
    // (e.g. DOMException in some browsers, plain { message } objects).
    const maybeMessage = (p as { message?: unknown }).message
    if (typeof maybeMessage === "string" && maybeMessage) {
      const maybeName = (p as { name?: unknown }).name
      const name = typeof maybeName === "string" && maybeName ? maybeName : "Error"
      return `${name}: ${maybeMessage}`
    }
    try {
      const json = JSON.stringify(p)
      return typeof json === "string" ? json : String(p)
    } catch {
      return String(p)
    }
  }
  return String(p)
}

function formatLogMessage(level: string, message: string, optionalParams: unknown[]): string {
  const timestamp = new Date().toISOString()
  const paramsStr = optionalParams.length > 0 ? " " + optionalParams.map(formatParam).join(" ") : ""

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
