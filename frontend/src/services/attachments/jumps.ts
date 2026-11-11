// "Jump to message" from the storage page (/files), which runs in its own tab
// or window: the main app tab opens the message; without one, a new app tab
// opens it from the URL.
import { isElectron } from "@/services/electron"

const CHANNEL = "orbital-message-jump"
const QUERY_KEY = "open_message"

interface JumpMessage {
  type: "jump"
  roomId: string
  messageId: string
}

interface AckMessage {
  type: "ack"
  messageId: string
}

/** Ask an open app tab to show a message; opens a new one if none answers. */
export function requestMessageJump(roomId: string, messageId: string) {
  const fallback = () => {
    const target = `${roomId}:${messageId}`
    const url = isElectron()
      ? `${window.location.href.split("#")[0]}#/?${QUERY_KEY}=${encodeURIComponent(target)}`
      : `${window.location.origin}/?${QUERY_KEY}=${encodeURIComponent(target)}`
    window.open(url, "_blank")
  }
  if (typeof BroadcastChannel === "undefined") return fallback()
  const bc = new BroadcastChannel(CHANNEL)
  const timer = setTimeout(() => {
    bc.close()
    fallback()
  }, 400)
  bc.onmessage = (e: MessageEvent<AckMessage>) => {
    if (e.data?.type === "ack" && e.data.messageId === messageId) {
      clearTimeout(timer)
      bc.close()
    }
  }
  bc.postMessage({ type: "jump", roomId, messageId } satisfies JumpMessage)
}

/**
 * In the app tab: open jump requests (from the URL on load, and from the
 * storage page while running). Returns a cleanup function.
 */
export function listenForMessageJumps(
  open: (roomId: string, messageId: string) => void,
  canHandle: () => boolean,
): () => void {
  const params = new URLSearchParams(
    isElectron() ? (window.location.hash.split("?")[1] ?? "") : window.location.search,
  )
  const initial = params.get(QUERY_KEY)
  if (initial?.includes(":")) {
    const [roomId, messageId] = initial.split(":")
    open(roomId, messageId)
  }
  if (typeof BroadcastChannel === "undefined") return () => {}
  const bc = new BroadcastChannel(CHANNEL)
  bc.onmessage = (e: MessageEvent<JumpMessage>) => {
    if (e.data?.type !== "jump" || !canHandle()) return
    bc.postMessage({ type: "ack", messageId: e.data.messageId } satisfies AckMessage)
    window.focus()
    open(e.data.roomId, e.data.messageId)
  }
  return () => bc.close()
}
