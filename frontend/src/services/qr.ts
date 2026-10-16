import { encodeQR } from "qr"
import { QRCanvas, rearCamera, frameLoop } from "qr/dom.js"
import sodium from "libsodium-wrappers"
import type { User } from "@/types"

// Single-use QR device linking ("link a new device").
//
// Security model: the new device generates an ephemeral X25519 keypair. The
// QR code carries only public values (challenge id + public key). The backend
// seals the fresh session token to the public key (libsodium sealed box) and
// only the private key held in memory on the new device can open it.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QRLoginKeypair {
  publicKeyB64: string
  privateKey: Uint8Array
}

export interface QRLoginPayload {
  version: 1
  challengeId: string
  publicKey: string
}

export interface OpenedAuthResponse {
  token: string
  user: User
  expires_at: string
}

export interface QRScanSession {
  stop(): void
  listDevices(): Promise<Array<{ deviceId: string; label: string }>>
  setDevice(deviceId: string): Promise<void>
}

// Minimal device summary used to build the human-readable device name shown
// on the approving device ("Chrome · Windows").
export interface QRDeviceSummary {
  browserName: string
  browserVersion: string
  platform: string
  isElectron: boolean
  isMobile: boolean
  electronOS?: string
}

// ---------------------------------------------------------------------------
// libsodium bootstrap
// ---------------------------------------------------------------------------

let sodiumReady: Promise<unknown> | null = null

async function ensureSodium(): Promise<void> {
  sodiumReady ??= sodium.ready
  await sodiumReady
}

// ---------------------------------------------------------------------------
// Ephemeral keypair + sealed box
// ---------------------------------------------------------------------------

export async function generateLoginKeypair(): Promise<QRLoginKeypair> {
  await ensureSodium()
  const kp = sodium.crypto_box_keypair()
  return {
    publicKeyB64: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    privateKey: kp.privateKey,
  }
}

function decodeKeyB64(raw: string): Uint8Array {
  const text = raw.trim()
  for (const variant of [sodium.base64_variants.ORIGINAL, sodium.base64_variants.URLSAFE]) {
    try {
      const bytes = sodium.from_base64(text, variant)
      if (bytes.length === 32) return bytes
    } catch {
      // try the next variant
    }
  }
  throw new Error("Invalid public key")
}

// openSealedAuthResponse opens a backend-sealed pairing payload and validates
// its shape. The opened bytes are wiped before returning.
export async function openSealedAuthResponse(
  sealedB64: string,
  publicKeyB64: string,
  privateKey: Uint8Array,
): Promise<OpenedAuthResponse> {
  await ensureSodium()

  let sealed: Uint8Array
  let pub: Uint8Array
  try {
    sealed = sodium.from_base64(sealedB64.trim(), sodium.base64_variants.ORIGINAL)
    pub = decodeKeyB64(publicKeyB64)
  } catch {
    throw new Error("Invalid pairing payload encoding")
  }

  let opened: Uint8Array
  try {
    opened = sodium.crypto_box_seal_open(sealed, pub, privateKey)
  } catch {
    throw new Error("Could not open the pairing payload on this device")
  }

  let parsed: Partial<OpenedAuthResponse>
  try {
    parsed = JSON.parse(sodium.to_string(opened)) as Partial<OpenedAuthResponse>
  } catch {
    throw new Error("Invalid pairing payload contents")
  } finally {
    opened.fill(0)
  }
  if (!parsed || typeof parsed.token !== "string" || parsed.token.length === 0) {
    throw new Error("Invalid pairing payload contents")
  }
  if (
    !parsed.user ||
    typeof parsed.user.id !== "string" ||
    typeof parsed.user.nickname !== "string"
  ) {
    throw new Error("Invalid pairing payload contents")
  }
  if (typeof parsed.expires_at !== "string") {
    throw new Error("Invalid pairing payload contents")
  }
  // Guests must never arrive through device linking (defense in depth; the
  // backend rejects guest approvals too).
  if (parsed.user.is_guest) {
    throw new Error("guest sessions cannot be linked")
  }
  return { token: parsed.token, user: parsed.user, expires_at: parsed.expires_at }
}

// ---------------------------------------------------------------------------
// QR payload (what the code on screen encodes)
// ---------------------------------------------------------------------------

const MAX_QR_PAYLOAD_LEN = 1024
const MAX_CHALLENGE_ID_LEN = 128

export function buildQRLoginPayload(challengeId: string, publicKeyB64: string): string {
  return JSON.stringify({ v: 1, c: challengeId, k: publicKeyB64 })
}

function canonicalPublicKey(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("This QR code is not an Orbital login code")
  const bytes = decodeKeyB64(raw)
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL)
}

export function parseQRLoginPayload(text: string): QRLoginPayload {
  if (text.length === 0 || text.length > MAX_QR_PAYLOAD_LEN) {
    throw new Error("This QR code is not an Orbital login code")
  }
  let obj: unknown
  try {
    obj = JSON.parse(text) as unknown
  } catch {
    throw new Error("This QR code is not an Orbital login code")
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("This QR code is not an Orbital login code")
  }
  const { v, c, k } = obj as Record<string, unknown>
  if (v !== 1 || typeof c !== "string" || c.length === 0 || c.length > MAX_CHALLENGE_ID_LEN) {
    throw new Error("This QR code is not an Orbital login code")
  }
  return { version: 1, challengeId: c, publicKey: canonicalPublicKey(k) }
}

// ---------------------------------------------------------------------------
// Dots-profile QR renderer (25% error correction, custom dot styling)
// ---------------------------------------------------------------------------

const QR_FG = "#0f172a"
const QR_BG = "#ffffff"

function finderZones(
  r0: number,
  r1: number,
  c0: number,
  c1: number,
): Array<{ r: number; c: number }> {
  return [
    { r: r0, c: c0 },
    { r: r0, c: c1 - 6 },
    { r: r1 - 6, c: c0 },
  ]
}

function inFinder(r: number, c: number, zones: Array<{ r: number; c: number }>): boolean {
  return zones.some((z) => r >= z.r && r < z.r + 7 && c >= z.c && c < z.c + 7)
}

// renderDotsQR renders the payload as an SVG string: dark modules as dots,
// the three finder patterns as rounded "eyes". Uses quartile (25%) error
// correction so the styled code stays reliably scannable.
export function renderDotsQR(payload: string): string {
  let matrix: boolean[][]
  try {
    matrix = encodeQR(payload, "raw", { ecc: "quartile" })
  } catch {
    throw new Error("Could not generate the login code")
  }

  const n = matrix.length
  let r0 = n,
    r1 = -1,
    c0 = n,
    c1 = -1
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r]?.[c]) {
        if (r < r0) r0 = r
        if (r > r1) r1 = r
        if (c < c0) c0 = c
        if (c > c1) c1 = c
      }
    }
  }
  if (r1 < r0) throw new Error("Could not generate the login code")

  const zones = finderZones(r0, r1, c0, c1)
  const cell = 10
  const quiet = 4
  const size = (n + quiet * 2) * cell
  // Explicit pixel dimensions give the inline SVG an intrinsic size: without
  // them it defaults to width:100% and collapses inside a shrink-to-fit
  // (inline-block) parent, leaving only the background visible.
  const display = 288
  const fmt = (v: number): string => (Math.round(v * 100) / 100).toString()

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${display}" height="${display}" style="display:block;max-width:100%;height:auto" role="img" aria-label="Login QR code">`,
    `<rect width="${size}" height="${size}" rx="${fmt(cell * 2)}" fill="${QR_BG}"/>`,
  ]

  // Data modules as dots
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r]?.[c] || inFinder(r, c, zones)) continue
      const cx = fmt((c + quiet + 0.5) * cell)
      const cy = fmt((r + quiet + 0.5) * cell)
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${fmt(cell * 0.44)}" fill="${QR_FG}"/>`)
    }
  }

  // Finder "eyes": rounded outer square, light separator, dark core
  for (const z of zones) {
    const x = (z.c + quiet) * cell
    const y = (z.r + quiet) * cell
    const w = 7 * cell
    parts.push(
      `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(w)}" rx="${fmt(cell * 1.7)}" fill="${QR_FG}"/>`,
      `<rect x="${fmt(x + cell)}" y="${fmt(y + cell)}" width="${fmt(w - 2 * cell)}" height="${fmt(w - 2 * cell)}" rx="${fmt(cell * 1.1)}" fill="${QR_BG}"/>`,
      `<rect x="${fmt(x + 2 * cell)}" y="${fmt(y + 2 * cell)}" width="${fmt(w - 4 * cell)}" height="${fmt(w - 4 * cell)}" rx="${fmt(cell * 0.7)}" fill="${QR_FG}"/>`,
    )
  }

  parts.push("</svg>")
  return parts.join("")
}

// ---------------------------------------------------------------------------
// Camera scan session (rear camera by default on mobile)
// ---------------------------------------------------------------------------

export async function startLoginScanSession(
  video: HTMLVideoElement,
  onPayload: (payload: QRLoginPayload) => void,
  onError?: (message: string) => void,
): Promise<QRScanSession> {
  const canvas = new QRCanvas()
  let camera
  try {
    // rearCamera selects the environment-facing camera: the side you point at
    // a QR code, which is the right default on phones.
    camera = await rearCamera(video)
  } catch {
    throw new Error("Could not access the camera. Check permissions and use HTTPS.")
  }

  let stopped = false
  let settled = false
  const cancel = frameLoop(async () => {
    if (stopped || settled) return
    let res
    try {
      res = await camera.readFrame(canvas)
    } catch {
      onError?.("Camera frame could not be read")
      return
    }
    if (typeof res !== "string" || settled) return
    try {
      const payload = parseQRLoginPayload(res)
      settled = true
      onPayload(payload)
    } catch {
      // A QR code, but not an Orbital login code: keep scanning.
    }
  }, video)

  return {
    stop() {
      stopped = true
      cancel()
      try {
        canvas.clear()
      } catch {
        // clearing a never-used canvas is a no-op
      }
      camera.stop()
    },
    listDevices: () => camera.listDevices(),
    setDevice: (deviceId: string) => camera.setDevice(deviceId),
  }
}

// ---------------------------------------------------------------------------
// Device naming for the approval dialog
// ---------------------------------------------------------------------------

export function formatQRDeviceName(summary: QRDeviceSummary): string {
  const browser = summary.browserVersion
    ? `${summary.browserName} ${summary.browserVersion}`
    : summary.browserName
  if (summary.isElectron) {
    const os = summary.electronOS || summary.platform
    return `Desktop app · ${os}`.slice(0, 120)
  }
  if (summary.isMobile) {
    return `Mobile · ${browser || summary.platform}`.slice(0, 120)
  }
  return `${browser || "Browser"} · ${summary.platform}`.slice(0, 120)
}
