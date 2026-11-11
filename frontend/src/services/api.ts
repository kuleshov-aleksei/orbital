import {
  Room,
  User,
  CreateRoomData,
  UpdateRoomData,
  Category,
  CreateCategoryData,
  RenameCategoryData,
  DeleteCategoryData,
  PublicUser,
  DebugLog,
  AudioFile,
  SoundboardSound,
  CustomEmojiDto,
  StatsStatus,
  AnalyticsReport,
  SecuritySelfCheckReport,
} from "@/types"
import type {
  TextHistoryCursor,
  TextHistoryPage,
  TextContextPage,
  TextUnreadResponse,
  TextPinsResponse,
  TextSearchResponse,
  TextSearchSort,
  TextNotifyMode,
  TextMuteDuration,
  TextNotifySetting,
  AttachmentBulkAction,
  AttachmentBulkResponse,
  AttachmentUploadResponse,
  AttachmentUrlsResponse,
  AttachmentUsage,
  AttachmentVariant,
  MyAttachmentsPage,
  MyAttachmentsQuery,
  TextAttachment,
} from "@/types/textChat"
import type {
  HalloweenGameConfig,
  HalloweenStateResponse,
  PumpkinStatesResponse,
  HalloweenGameReport,
  SubmitGameReportResponse,
  HalloweenLeaderboardEntry,
  HalloweenAdminGame,
  HalloweenAdminReward,
  HalloweenItem,
  HalloweenBaseSocket,
  CreateHalloweenItemRequest,
  UpdateHalloweenItemRequest,
  UpsertBaseSocketsRequest,
  HalloweenPackageResult,
} from "@/halloween/types"
import type {
  MyPermissions,
  PermissionOverwrite,
  OverwriteTargetType,
  OverwriteSubjectType,
  Role,
  RolesResponse,
} from "@/types/permissions"
import { isElectron, openExternal, oauthAuthenticate } from "./electron"

const API_BASE = typeof __BACKEND_URL__ !== "undefined" ? `${__BACKEND_URL__}/api` : "/api"

export const BACKEND_BASE = typeof __BACKEND_URL__ !== "undefined" ? __BACKEND_URL__ : ""

export function resolveUrl(relativePath: string): string {
  if (
    !relativePath ||
    relativePath.startsWith("http://") ||
    relativePath.startsWith("https://") ||
    relativePath.startsWith("data:")
  ) {
    return relativePath
  }
  if (relativePath.startsWith("//")) {
    return `https:${relativePath}`
  }
  if (relativePath.startsWith("/")) {
    return BACKEND_BASE ? `${BACKEND_BASE}${relativePath}` : relativePath
  }
  return relativePath
}

// Token storage
let currentToken: string | null = null

export function setAuthToken(token: string | null) {
  currentToken = token
  if (token) {
    localStorage.setItem("orbital_auth_token", token)
  } else {
    localStorage.removeItem("orbital_auth_token")
  }
}

export function getAuthToken(): string | null {
  if (!currentToken) {
    currentToken = localStorage.getItem("orbital_auth_token")
  }
  return currentToken
}

export function clearAuthToken() {
  currentToken = null
  localStorage.removeItem("orbital_auth_token")
  localStorage.removeItem("orbital_token_expires_at")
}

// Token expiry is persisted alongside the token so the app can proactively
// refresh before the JWT lapses instead of silently failing mid-session.
export function setTokenExpiry(expiresAt: string | null) {
  if (expiresAt) {
    localStorage.setItem("orbital_token_expires_at", expiresAt)
  } else {
    localStorage.removeItem("orbital_token_expires_at")
  }
}

export function getTokenExpiry(): number | null {
  const raw = localStorage.getItem("orbital_token_expires_at")
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : ms
}

// Treat the token as expired this long before its real expiry so a request
// never races the clock.
const EXPIRY_SKEW_MS = 60 * 1000

// Refresh once the token is within this window of expiring. With a 60-day TTL
// this fires on app start / tab focus for sessions older than ~53 days.
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// Unknown expiry (legacy token) is treated as valid; the server's 401 is the
// source of truth in that case.
export function isTokenExpired(): boolean {
  const exp = getTokenExpiry()
  if (exp === null) return false
  return Date.now() >= exp - EXPIRY_SKEW_MS
}

export function tokenNeedsRefresh(): boolean {
  const exp = getTokenExpiry()
  if (exp === null) return false
  return Date.now() >= exp - REFRESH_WINDOW_MS
}

// Called when the session is definitively gone (401 with no refresh possible).
// The user store registers a handler to clear state and show the auth view.
type SessionExpiredHandler = () => void
let sessionExpiredHandler: SessionExpiredHandler | null = null

export function setOnSessionExpired(handler: SessionExpiredHandler | null) {
  sessionExpiredHandler = handler
}

function notifySessionExpired() {
  setAuthToken(null)
  setTokenExpiry(null)
  sessionExpiredHandler?.()
}

// TURN server configuration types
export interface ICEServer {
  urls: string[]
  username?: string
  credential?: string
}

export interface TURNConfigResponse {
  ice_servers: ICEServer[]
  ttl: number
}

// Auth response types
export interface AuthResponse {
  token: string
  user: User
  expires_at: string
}

export interface AuthStatus {
  discord_enabled: boolean
  google_enabled: boolean
  password_enabled: boolean
}

// Login request/response types (snake_case for backend)
interface LoginRequest {
  login: string
  password: string
}

interface LoginResponse {
  token: string
  user: User
  expires_at: string
}

interface RegisterRequest {
  email: string
  nickname: string
  password: string
}

// QR device linking types (snake_case for backend)
export interface QRChallengeCreateRequest {
  public_key: string
  device_name: string
  device_info: string
}

export interface QRChallengeCreated {
  challenge_id: string
  expires_at: string
}

export interface QRChallengeView {
  challenge_id: string
  public_key: string
  device_name: string
  device_info: string
  status: string
  expires_at: string
}

export interface QRClaimResult {
  status: string
  sealed_payload?: string
  expires_at?: string
}

// Room configuration types
export interface RoomConfig {
  min_users: number
  max_users: number
  default_max_users: number
}

// General application configuration
export interface AppConfig {
  room: RoomConfig
  text_channels?: boolean
  /** Present when text channel attachments are enabled (S3 configured). */
  attachments?: AttachmentsConfig
}

export interface AttachmentsConfig {
  max_image_bytes: number
  max_audio_bytes: number
  max_video_bytes: number
  quota_bytes: number
  max_per_message: number
}

/** Client-measured display metadata sent with an upload. */
export interface AttachmentUploadMeta {
  peaks?: number[]
  durationMs?: number
  width?: number
  height?: number
}

/** A failed attachment upload; code is the backend error code. */
export class AttachmentUploadError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
    this.name = "AttachmentUploadError"
  }
}

function sendUpload(
  url: string,
  form: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    const token = getAuthToken()
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText })
    xhr.onerror = () => reject(new AttachmentUploadError("network_error", 0))
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"))
    signal?.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(form)
  })
}

/**
 * Upload one file to a text channel (XHR for progress). Resolves with the
 * pending upload; the message is sent later with its upload_id.
 */
export async function uploadTextAttachment(
  roomId: string,
  file: File,
  meta: AttachmentUploadMeta,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<AttachmentUploadResponse> {
  const form = new FormData()
  if (meta.peaks?.length) form.append("peaks", JSON.stringify(meta.peaks))
  if (meta.durationMs) form.append("duration_ms", String(Math.round(meta.durationMs)))
  if (meta.width) form.append("width", String(meta.width))
  if (meta.height) form.append("height", String(meta.height))
  form.append("file", file, file.name)
  const url = `${API_BASE}/rooms/${encodeURIComponent(roomId)}/attachments`
  let res = await sendUpload(url, form, onProgress, signal)
  if (res.status === 401 && !isTokenExpired() && (await refreshAuthToken())) {
    res = await sendUpload(url, form, onProgress, signal)
  }
  if (res.status === 401) notifySessionExpired()
  if (res.status < 200 || res.status >= 300) {
    let code = res.status === 429 ? "rate_limited" : "upload_failed"
    try {
      code = (JSON.parse(res.body) as { error?: string }).error ?? code
    } catch {
      if (res.status === 403) code = "forbidden"
      else if (res.status === 404) code = "not_found"
      else if (res.status === 413) code = "file_too_large"
    }
    throw new AttachmentUploadError(code, res.status)
  }
  return JSON.parse(res.body) as AttachmentUploadResponse
}

// Latest desktop release, resolved by the backend from the update feed
// (latest.yml). Artifact URLs are absolute links to the update host.
export interface LatestRelease {
  version: string
  windows_url: string
  linux_url: string
}

// LiveKit token response types
export interface LiveKitTokenResponse {
  token: string
  room_url: string
}

// API error carrying the HTTP status so callers can distinguish an expired
// session (401) from a transient failure (network / 5xx).
export interface ApiError extends Error {
  status?: number
}

function apiError(message: string, status: number): ApiError {
  const error = new Error(message) as ApiError
  error.status = status
  return error
}

// Endpoints whose 401 means "bad credentials" rather than "session expired" -
// they must never trigger a refresh attempt or the session-expired flow.
const AUTH_ENDPOINTS_NO_RETRY = ["/auth/login", "/auth/register", "/auth/guest", "/auth/refresh"]

function isCredentialEndpoint(endpoint: string): boolean {
  return AUTH_ENDPOINTS_NO_RETRY.some((path) => endpoint.startsWith(path))
}

// Single-flight refresh: concurrent 401s share one /auth/refresh call.
let refreshPromise: Promise<boolean> | null = null

export async function refreshAuthToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const token = getAuthToken()
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!response.ok) return false

      const data = (await response.json()) as AuthResponse
      setAuthToken(data.token)
      setTokenExpiry(data.expires_at)
      return true
    } catch {
      return false
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

// Generic API wrapper with error handling
export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  allowRetry = true,
): Promise<T> {
  try {
    // Multipart uploads set their own Content-Type (with boundary).
    const isMultipart = typeof FormData !== "undefined" && options.body instanceof FormData
    const headers: Record<string, string> = {
      ...(isMultipart ? {} : { "Content-Type": "application/json" }),
      ...(options.headers as Record<string, string>),
    }

    // Add auth token if available
    const token = getAuthToken()
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers,
      ...options,
    })

    // Expired/invalid session: try one silent refresh, then retry the request.
    if (response.status === 401 && allowRetry && !isCredentialEndpoint(endpoint)) {
      const refreshed = !isTokenExpired() && (await refreshAuthToken())
      if (refreshed) {
        return apiRequest<T>(endpoint, options, false)
      }
    }

    if (!response.ok) {
      // Any unrecovered 401 on a protected endpoint means the session is gone.
      if (response.status === 401 && !isCredentialEndpoint(endpoint)) {
        notifySessionExpired()
        throw apiError("Session expired", 401)
      }
      if (response.status === 413) {
        // Limits differ per endpoint (e.g. soundboard 1MB); the client checks them first.
        throw apiError("File too large.", 413)
      }
      const errorText = await response.text()
      throw apiError(errorText || `Upload failed (${response.status})`, response.status)
    }

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  } catch (error) {
    console.error(`API request failed to ${endpoint}:`, error)
    throw error
  }
}

// Room management API calls
export const apiService = {
  // Get all available rooms
  async getRooms(includePreview = false): Promise<Room[]> {
    const endpoint = includePreview ? "/rooms?preview=true" : "/rooms"
    return apiRequest<Room[]>(endpoint)
  },

  // Get specific room details
  async getRoom(roomId: string): Promise<Room> {
    return apiRequest<Room>(`/rooms/${roomId}`)
  },

  // Create a new room
  async createRoom(data: CreateRoomData): Promise<Room> {
    return apiRequest<Room>("/rooms", {
      method: "POST",
      body: JSON.stringify(data),
    })
  },

  // Update a room
  async updateRoom(roomId: string, data: UpdateRoomData): Promise<Room> {
    return apiRequest<Room>(`/rooms/${roomId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  },

  // Delete a room
  async deleteRoom(roomId: string): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/rooms/${roomId}`, {
      method: "DELETE",
    })
  },

  // Join a room
  async joinRoom(roomId: string, userData: { user_id?: string; nickname?: string }): Promise<User> {
    return apiRequest<User>(`/rooms/${roomId}/join`, {
      method: "POST",
      body: JSON.stringify(userData),
    })
  },

  // Leave a room
  async leaveRoom(roomId: string, userId: string): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/rooms/${roomId}/leave`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    })
  },

  // Kick a user from a room
  async kickUser(roomId: string, userId: string): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/rooms/${roomId}/kick/${userId}`, {
      method: "POST",
    })
  },

  // Get users in a room
  async getRoomUsers(roomId: string): Promise<User[]> {
    return apiRequest<User[]>(`/rooms/${roomId}/users`)
  },

  // Update room order for drag-and-drop
  async updateRoomOrder(orders: Record<string, number>): Promise<{ status: string }> {
    return apiRequest<{ status: string }>("/rooms/order", {
      method: "PUT",
      body: JSON.stringify({ orders }),
    })
  },

  // Health check
  async healthCheck(): Promise<{
    status: string
    service: string
    version: string
  }> {
    return apiRequest<{ status: string; service: string; version: string }>("/health")
  },

  // Get general application configuration
  async getConfig(): Promise<AppConfig> {
    return apiRequest<AppConfig>("/config")
  },

  // Text channels (history over REST; writes go over the global WebSocket)
  async getTextMessages(roomId: string, cursor: TextHistoryCursor = {}): Promise<TextHistoryPage> {
    const params = new URLSearchParams()
    if (cursor.beforeSeq) params.set("before_seq", String(cursor.beforeSeq))
    if (cursor.afterSeq) params.set("after_seq", String(cursor.afterSeq))
    if (cursor.aroundSeq) params.set("around_seq", String(cursor.aroundSeq))
    if (cursor.limit) params.set("limit", String(cursor.limit))
    const query = params.toString()
    return apiRequest<TextHistoryPage>(
      `/rooms/${encodeURIComponent(roomId)}/messages${query ? `?${query}` : ""}`,
    )
  },

  async getTextMessageContext(messageId: string, n = 25): Promise<TextContextPage> {
    return apiRequest<TextContextPage>(`/messages/${encodeURIComponent(messageId)}/context?n=${n}`)
  },

  async getTextUnread(): Promise<TextUnreadResponse> {
    return apiRequest<TextUnreadResponse>("/chat/unread")
  },

  async getTextPins(roomId: string): Promise<TextPinsResponse> {
    return apiRequest<TextPinsResponse>(`/rooms/${encodeURIComponent(roomId)}/pins`)
  },

  async searchTextMessages(
    q: string,
    opts: { sort?: TextSearchSort; offset?: number; limit?: number; signal?: AbortSignal } = {},
  ): Promise<TextSearchResponse> {
    const params = new URLSearchParams({ q, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
    if (opts.sort) params.set("sort", opts.sort)
    if (opts.offset) params.set("offset", String(opts.offset))
    if (opts.limit) params.set("limit", String(opts.limit))
    return apiRequest<TextSearchResponse>(`/chat/search?${params}`, { signal: opts.signal })
  },

  async setTextNotify(
    roomId: string,
    mode: TextNotifyMode,
    muteDuration?: TextMuteDuration,
  ): Promise<TextNotifySetting> {
    return apiRequest<TextNotifySetting>(`/rooms/${encodeURIComponent(roomId)}/notify`, {
      method: "PUT",
      body: JSON.stringify(mode === "muted" ? { mode, mute_duration: muteDuration } : { mode }),
    })
  },

  // --- Text channel attachments (docs/specs/CHAT_SYSTEM.md §7.12) ---

  /** Presigned URLs for files (img/video cannot send the auth header). */
  async getAttachmentUrls(
    items: { id: string; variant: AttachmentVariant }[],
  ): Promise<AttachmentUrlsResponse> {
    return apiRequest<AttachmentUrlsResponse>("/attachments/urls", {
      method: "POST",
      body: JSON.stringify({ items }),
    })
  },

  async setAttachmentProtected(id: string, isProtected: boolean): Promise<TextAttachment> {
    const res = await apiRequest<{ attachment: TextAttachment }>(
      `/attachments/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ protected: isProtected }) },
    )
    return res.attachment
  },

  async deleteAttachment(id: string): Promise<void> {
    await apiRequest<void>(`/attachments/${encodeURIComponent(id)}`, { method: "DELETE" })
  },

  async listMyAttachments(query: MyAttachmentsQuery = {}): Promise<MyAttachmentsPage> {
    const params = new URLSearchParams()
    if (query.kind) params.set("kind", query.kind)
    if (query.roomId) params.set("room_id", query.roomId)
    if (query.sort) params.set("sort", query.sort)
    if (query.q) params.set("q", query.q)
    if (query.protectedOnly) params.set("protected", "1")
    if (query.cursor) params.set("cursor", query.cursor)
    if (query.limit) params.set("limit", String(query.limit))
    const qs = params.toString()
    return apiRequest<MyAttachmentsPage>(`/me/attachments${qs ? `?${qs}` : ""}`)
  },

  async getMyAttachmentUsage(): Promise<AttachmentUsage> {
    return apiRequest<AttachmentUsage>("/me/attachments/usage")
  },

  async bulkMyAttachments(
    ids: string[],
    action: AttachmentBulkAction,
  ): Promise<AttachmentBulkResponse> {
    return apiRequest<AttachmentBulkResponse>("/me/attachments/bulk", {
      method: "POST",
      body: JSON.stringify({ ids, action }),
    })
  },

  // Get the latest desktop release (version + artifact URLs), resolved by
  // the backend from the update feed. Throws when unavailable; callers
  // should fall back to the bundled app version.
  async getLatestRelease(): Promise<LatestRelease> {
    return apiRequest<LatestRelease>("/releases/latest")
  },

  // Category management
  async getCategories(): Promise<Category[]> {
    return apiRequest<Category[]>("/categories")
  },

  async createCategory(data: CreateCategoryData): Promise<Category> {
    return apiRequest<Category>("/categories", {
      method: "POST",
      body: JSON.stringify(data),
    })
  },

  async renameCategory(categoryId: string, data: RenameCategoryData): Promise<Category> {
    return apiRequest<Category>(`/categories/${categoryId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  },

  async deleteCategory(categoryId: string, data: DeleteCategoryData): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/categories/${categoryId}`, {
      method: "DELETE",
      body: JSON.stringify(data),
    })
  },

  // Update category order for drag-and-drop
  async updateCategoryOrder(orders: Record<string, number>): Promise<{ status: string }> {
    return apiRequest<{ status: string }>("/categories/reorder", {
      method: "PUT",
      body: JSON.stringify({ orders }),
    })
  },

  // Get TURN server configuration for WebRTC
  async getTurnConfig(userId?: string): Promise<TURNConfigResponse> {
    const endpoint = userId ? `/turn-config?user_id=${userId}` : "/turn-config"
    return apiRequest<TURNConfigResponse>(endpoint)
  },

  // Halloween API calls
  async getHalloweenConfig(): Promise<HalloweenGameConfig> {
    return apiRequest<HalloweenGameConfig>("/halloween/game/config")
  },

  async getHalloweenState(): Promise<HalloweenStateResponse> {
    return apiRequest<HalloweenStateResponse>("/halloween/state")
  },

  async getHalloweenPumpkinStates(userIds: string[]): Promise<PumpkinStatesResponse> {
    const ids = encodeURIComponent(userIds.join(","))
    return apiRequest<PumpkinStatesResponse>(`/halloween/pumpkin-states?user_ids=${ids}`)
  },

  async updatePumpkin(equippedJson: string): Promise<{ status: string }> {
    return apiRequest<{ status: string }>("/halloween/pumpkin", {
      method: "PUT",
      body: JSON.stringify({ equipped_json: equippedJson }),
    })
  },

  async submitHalloweenGame(report: HalloweenGameReport): Promise<SubmitGameReportResponse> {
    return apiRequest<SubmitGameReportResponse>("/halloween/game/report", {
      method: "POST",
      body: JSON.stringify(report),
    })
  },

  async getHalloweenLeaderboard(): Promise<HalloweenLeaderboardEntry[]> {
    return apiRequest<HalloweenLeaderboardEntry[]>("/halloween/leaderboard")
  },

  // Halloween admin calls (super_admin only)
  async getHalloweenAdminGames(): Promise<HalloweenAdminGame[]> {
    return apiRequest<HalloweenAdminGame[]>("/admin/halloween/games")
  },

  async getHalloweenAdminItems(): Promise<HalloweenItem[]> {
    return apiRequest<HalloweenItem[]>("/admin/halloween/items")
  },

  async getHalloweenAdminRewards(): Promise<HalloweenAdminReward[]> {
    return apiRequest<HalloweenAdminReward[]>("/admin/halloween/rewards")
  },

  async issueHalloweenReward(
    userId: string,
    itemId: string,
  ): Promise<{ status: string; message: string; granted: boolean }> {
    return apiRequest<{ status: string; message: string; granted: boolean }>(
      "/admin/halloween/rewards",
      {
        method: "POST",
        body: JSON.stringify({ user_id: userId, item_id: itemId }),
      },
    )
  },

  // Halloween catalog + socket-layout admin (super_admin only, snake_case).
  async createHalloweenItem(payload: CreateHalloweenItemRequest): Promise<HalloweenItem> {
    return apiRequest<HalloweenItem>("/admin/halloween/items", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },

  async updateHalloweenItem(
    id: string,
    payload: UpdateHalloweenItemRequest,
  ): Promise<HalloweenItem> {
    return apiRequest<HalloweenItem>(`/admin/halloween/items/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
  },

  async deleteHalloweenItem(id: string): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/admin/halloween/items/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
  },

  async restoreHalloweenItem(id: string): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(
      `/admin/halloween/items/${encodeURIComponent(id)}/restore`,
      { method: "POST" },
    )
  },

  async uploadHalloweenItemAsset(id: string, file: File): Promise<HalloweenItem> {
    const form = new FormData()
    form.append("asset", file)
    return apiRequest<HalloweenItem>(`/admin/halloween/items/${encodeURIComponent(id)}/asset`, {
      method: "POST",
      body: form,
    })
  },

  async getHalloweenBaseLayouts(baseId: string): Promise<HalloweenBaseSocket[]> {
    return apiRequest<HalloweenBaseSocket[]>(
      `/admin/halloween/layouts?base_id=${encodeURIComponent(baseId)}`,
    )
  },

  async saveHalloweenBaseLayouts(payload: UpsertBaseSocketsRequest): Promise<{ status: string }> {
    return apiRequest<{ status: string }>("/admin/halloween/layouts", {
      method: "PUT",
      body: JSON.stringify(payload),
    })
  },

  // Halloween config package export/import (super_admin only, snake_case).
  // The package is an uncompressed .tar: config.json (definitions + layouts)
  // plus assets/<id>.png art. apiRequest only handles JSON, so export uses a
  // raw authenticated fetch returning a Blob.
  async exportHalloweenPackage(): Promise<Blob> {
    const token = getAuthToken()
    const response = await fetch(`${API_BASE}/admin/halloween/config/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) {
      const errorText = await response.text()
      throw apiError(errorText || `Export failed (${response.status})`, response.status)
    }
    return await response.blob()
  },

  async importHalloweenPackage(file: File): Promise<HalloweenPackageResult> {
    const form = new FormData()
    form.append("package", file)
    return apiRequest<HalloweenPackageResult>("/admin/halloween/config/import", {
      method: "POST",
      body: form,
    })
  },

  // Auth API calls
  async getOAuthUrl(
    provider: "discord" | "google",
    isElectronApp = false,
  ): Promise<{ url: string; state: string }> {
    const endpoint = isElectronApp ? `/auth/${provider}/url?electron=true` : `/auth/${provider}/url`
    const response = await apiRequest<{ url: string; state: string }>(endpoint)
    return response
  },

  async initiateOAuthLogin(provider: "discord" | "google"): Promise<void> {
    if (isElectron()) {
      const { url, state } = await this.getOAuthUrl(provider, true)
      await oauthAuthenticate(state)
      await openExternal(url)
    } else {
      window.location.href = `${API_BASE}/auth/${provider}/login`
    }
  },

  initiateDiscordLogin(): void {
    void this.initiateOAuthLogin("discord")
  },

  initiateGoogleLogin(): void {
    void this.initiateOAuthLogin("google")
  },

  async guestLogin(): Promise<AuthResponse> {
    const response = await apiRequest<AuthResponse>("/auth/guest", {
      method: "POST",
    })
    // Store token
    setAuthToken(response.token)
    setTokenExpiry(response.expires_at)
    return response
  },

  async register(email: string, nickname: string, password: string): Promise<AuthResponse> {
    // Backend expects snake_case (per AGENTS.md convention)
    const request: RegisterRequest = {
      email,
      nickname,
      password,
    }
    const response = await apiRequest<LoginResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(request),
    })
    // Store token
    setAuthToken(response.token)
    setTokenExpiry(response.expires_at)
    return response
  },

  async loginPassword(login: string, password: string): Promise<AuthResponse> {
    // Backend expects snake_case (per AGENTS.md convention)
    const request: LoginRequest = {
      login,
      password,
    }
    const response = await apiRequest<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(request),
    })
    // Store token
    setAuthToken(response.token)
    setTokenExpiry(response.expires_at)
    return response
  },

  // Slide the current session forward with a fresh token (see RefreshToken
  // backend handler). Callers should ensure the current token is not expired.
  async refreshToken(): Promise<AuthResponse> {
    const response = await apiRequest<AuthResponse>("/auth/refresh", {
      method: "POST",
    })
    setAuthToken(response.token)
    setTokenExpiry(response.expires_at)
    return response
  },

  async logout(): Promise<{ status: string; message: string }> {
    const response = await apiRequest<{ status: string; message: string }>("/auth/logout", {
      method: "POST",
    })
    // Clear token
    clearAuthToken()
    return response
  },

  // QR device linking. The new device has no session yet, so challenge
  // creation and claiming bypass the authenticated apiRequest wrapper: no
  // Authorization header, no refresh attempts, no session-expired flow.
  async createQRChallenge(req: QRChallengeCreateRequest): Promise<QRChallengeCreated> {
    const response = await fetch(`${API_BASE}/auth/qr/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify(req),
    })
    if (!response.ok) {
      throw apiError((await response.text()) || "Could not start device linking", response.status)
    }
    return (await response.json()) as QRChallengeCreated
  },

  // Polls a challenge: 202 means "not approved yet", 200 carries the sealed
  // payload exactly once, 404/410 end the wait.
  async claimQRChallenge(challengeId: string): Promise<QRClaimResult> {
    const response = await fetch(`${API_BASE}/auth/qr/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ challenge_id: challengeId }),
    })
    if (response.status === 202) {
      return { status: "pending" }
    }
    if (!response.ok) {
      throw apiError((await response.text()) || "Device linking failed", response.status)
    }
    return (await response.json()) as QRClaimResult
  },

  async getQRChallenge(challengeId: string): Promise<QRChallengeView> {
    return apiRequest<QRChallengeView>(`/auth/qr/challenge/${encodeURIComponent(challengeId)}`)
  },

  async approveQRChallenge(challengeId: string, publicKey: string): Promise<{ status: string }> {
    // Backend expects snake_case (per AGENTS.md convention)
    return apiRequest<{ status: string }>("/auth/qr/approve", {
      method: "POST",
      body: JSON.stringify({ challenge_id: challengeId, public_key: publicKey }),
    })
  },

  async getCurrentUser(): Promise<User> {
    return apiRequest<User>("/auth/me")
  },

  async getAuthStatus(): Promise<AuthStatus> {
    return apiRequest<AuthStatus>("/auth/status")
  },

  // Admin API calls
  async getUsers(): Promise<User[]> {
    return apiRequest<User[]>("/admin/users")
  },

  async getUserRole(userId: string): Promise<{ role: string }> {
    return apiRequest<{ role: string }>(`/admin/users/${userId}/role`)
  },

  // RBAC: permissions, roles, assignments and overwrites
  /** IDs of the users who can see a room (404 unless the caller can see it). */
  async getRoomViewers(roomId: string): Promise<{ user_ids: string[] }> {
    return apiRequest<{ user_ids: string[] }>(`/rooms/${encodeURIComponent(roomId)}/viewers`)
  },

  async getMyPermissions(): Promise<MyPermissions> {
    return apiRequest<MyPermissions>("/me/permissions")
  },

  async getRoles(): Promise<RolesResponse> {
    return apiRequest<RolesResponse>("/roles")
  },

  /** Picks which of my roles colors my nickname; null = automatic (highest). */
  async setMyColorRole(roleId: string | null): Promise<{ role_id: string }> {
    return apiRequest<{ role_id: string }>("/me/color-role", {
      method: "PUT",
      body: JSON.stringify({ role_id: roleId ?? "" }),
    })
  },

  async createRole(data: { name: string; color?: string; permissions?: number }): Promise<Role> {
    return apiRequest<Role>("/roles", { method: "POST", body: JSON.stringify(data) })
  },

  async updateRole(
    roleId: string,
    data: { name?: string; color?: string; permissions?: number; denyPermissions?: number },
  ): Promise<Role> {
    const body: Record<string, unknown> = {}
    if (data.name !== undefined) body.name = data.name
    if (data.color !== undefined) body.color = data.color
    if (data.permissions !== undefined) body.permissions = data.permissions
    if (data.denyPermissions !== undefined) body.deny_permissions = data.denyPermissions
    return apiRequest<Role>(`/roles/${roleId}`, { method: "PUT", body: JSON.stringify(body) })
  },

  async deleteRole(roleId: string): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/roles/${roleId}`, { method: "DELETE" })
  },

  async reorderRoles(positions: Record<string, number>): Promise<{ status: string }> {
    return apiRequest<{ status: string }>("/roles/order", {
      method: "PUT",
      body: JSON.stringify({ positions }),
    })
  },

  async setUserRoles(
    userId: string,
    roleIds: string[],
  ): Promise<{ user_id: string; role_ids: string[] }> {
    return apiRequest<{ user_id: string; role_ids: string[] }>(`/users/${userId}/roles`, {
      method: "PUT",
      body: JSON.stringify({ role_ids: roleIds }),
    })
  },

  async getOverwrites(
    targetType: OverwriteTargetType,
    targetId: string,
  ): Promise<PermissionOverwrite[]> {
    const prefix = targetType === "room" ? "rooms" : "categories"
    return apiRequest<PermissionOverwrite[]>(`/${prefix}/${targetId}/overwrites`)
  },

  async setOverwrite(
    targetType: OverwriteTargetType,
    targetId: string,
    subjectType: OverwriteSubjectType,
    subjectId: string,
    allow: number,
    deny: number,
  ): Promise<PermissionOverwrite> {
    const prefix = targetType === "room" ? "rooms" : "categories"
    return apiRequest<PermissionOverwrite>(
      `/${prefix}/${targetId}/overwrites/${subjectType}/${subjectId}`,
      { method: "PUT", body: JSON.stringify({ allow, deny }) },
    )
  },

  async deleteOverwrite(
    targetType: OverwriteTargetType,
    targetId: string,
    subjectType: OverwriteSubjectType,
    subjectId: string,
  ): Promise<{ status: string }> {
    const prefix = targetType === "room" ? "rooms" : "categories"
    return apiRequest<{ status: string }>(
      `/${prefix}/${targetId}/overwrites/${subjectType}/${subjectId}`,
      { method: "DELETE" },
    )
  },

  async setRoomPermissionsSynced(
    roomId: string,
    permissionsSynced: boolean,
  ): Promise<{ status: string }> {
    return apiRequest<{ status: string }>(`/rooms/${roomId}/permissions_synced`, {
      method: "PUT",
      body: JSON.stringify({ permissions_synced: permissionsSynced }),
    })
  },

  async deleteUser(userId: string): Promise<{ status: string; message: string }> {
    return apiRequest<{ status: string; message: string }>(`/admin/users/${userId}`, {
      method: "DELETE",
    })
  },

  async deleteAllGuests(): Promise<{ status: string; message: string; deleted_count: number }> {
    return apiRequest<{ status: string; message: string; deleted_count: number }>(
      `/admin/users/guests`,
      {
        method: "DELETE",
      },
    )
  },

  // Get all users (public information only)
  async getAllUsers(): Promise<PublicUser[]> {
    return apiRequest<PublicUser[]>("/users")
  },

  // Avatar upload
  async uploadAvatar(file: File): Promise<{ avatar_url: string }> {
    const formData = new FormData()
    formData.append("avatar", file)

    const token = getAuthToken()
    const response = await fetch(`${API_BASE}/users/me/avatar`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    })

    if (!response.ok) {
      if (response.status === 401) notifySessionExpired()
      const errorText = await response.text()
      throw new Error(`API Error: ${response.status} - ${errorText}`)
    }

    return response.json()
  },

  // Update sound pack preference
  async updateSoundPack(soundPack: string): Promise<{ sound_pack: string }> {
    const token = getAuthToken()
    const response = await fetch(`${API_BASE}/users/me/sound-pack`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ sound_pack: soundPack }),
    })

    if (!response.ok) {
      if (response.status === 401) notifySessionExpired()
      const errorText = await response.text()
      throw new Error(`API Error: ${response.status} - ${errorText}`)
    }

    return response.json()
  },

  // Update custom status text + emoji ref (empty strings clear them)
  async updateCustomStatus(
    customStatus: string,
    customStatusEmoji: string,
  ): Promise<{ custom_status: string; custom_status_emoji: string }> {
    const token = getAuthToken()
    const response = await fetch(`${API_BASE}/users/me/custom-status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        custom_status: customStatus,
        custom_status_emoji: customStatusEmoji,
      }),
    })

    if (!response.ok) {
      if (response.status === 401) notifySessionExpired()
      const errorText = await response.text()
      throw new Error(`API Error: ${response.status} - ${errorText}`)
    }

    return response.json()
  },

  // LiveKit token generation
  async getLiveKitToken(roomId: string): Promise<LiveKitTokenResponse> {
    return apiRequest<LiveKitTokenResponse>("/livekit/token", {
      method: "POST",
      body: JSON.stringify({ room_id: roomId }),
    })
  },

  // Debug log API calls
  async sendLogs(
    userId: string,
    username: string,
    version: string,
    logs: string,
    systemInfo?: string,
  ): Promise<{ status: string; message: string; log_id: number }> {
    return apiRequest<{ status: string; message: string; log_id: number }>("/logs", {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        username: username,
        version: version,
        logs: logs,
        system_info: systemInfo ?? "",
      }),
    })
  },

  async getLogs(): Promise<DebugLog[]> {
    return apiRequest<DebugLog[]>("/admin/logs")
  },

  async getLog(logId: number): Promise<{ log: DebugLog; content: string }> {
    return apiRequest<{ log: DebugLog; content: string }>(`/admin/logs/${logId}`)
  },

  async deleteLog(logId: number): Promise<{ status: string; message: string }> {
    return apiRequest<{ status: string; message: string }>(`/admin/logs/${logId}`, {
      method: "DELETE",
    })
  },

  // Audio file API calls
  async getAudioFiles(): Promise<AudioFile[]> {
    return apiRequest<AudioFile[]>("/audio")
  },

  async uploadAudio(
    file: File,
    displayName: string,
  ): Promise<{ id: string; display_name: string; audio_url: string }> {
    const formData = new FormData()
    formData.append("audio", file)
    formData.append("display_name", displayName)

    const token = getAuthToken()
    const response = await fetch(`${API_BASE}/audio/upload`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    })

    if (!response.ok) {
      if (response.status === 413) {
        throw new Error("File too large. Maximum size is 30MB.")
      }
      if (response.status === 401) notifySessionExpired()
      const errorText = await response.text()
      throw new Error(errorText || `Upload failed (${response.status})`)
    }

    return response.json()
  },

  async deleteAudio(id: string): Promise<void> {
    await apiRequest<void>(`/admin/audio/${id}`, {
      method: "DELETE",
    })
  },

  async renameAudio(id: string, displayName: string): Promise<void> {
    await apiRequest<void>(`/admin/audio/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ display_name: displayName }),
    })
  },

  getAudioUrl(id: string): string {
    return `${API_BASE}/audio/${id}`
  },

  // Soundboard API calls
  async getSoundboardSounds(): Promise<SoundboardSound[]> {
    return apiRequest<SoundboardSound[]>("/soundboard")
  },

  async uploadSoundboardSound(input: {
    file: File
    name: string
    emoji: string
    aliases: string[]
  }): Promise<SoundboardSound> {
    const form = new FormData()
    form.append("audio", input.file)
    form.append("name", input.name)
    form.append("emoji", input.emoji)
    form.append("aliases", JSON.stringify(input.aliases))
    return apiRequest<SoundboardSound>("/soundboard", { method: "POST", body: form })
  },

  async updateSoundboardSound(
    id: string,
    patch: { name?: string; emoji?: string; aliases?: string[] },
  ): Promise<SoundboardSound> {
    return apiRequest<SoundboardSound>(`/admin/soundboard/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    })
  },

  // Custom emoji API calls
  async getCustomEmojis(): Promise<CustomEmojiDto[]> {
    return apiRequest<CustomEmojiDto[]>("/emojis")
  },

  async uploadCustomEmoji(input: {
    file: File
    name: string
    aliases: string[]
  }): Promise<CustomEmojiDto> {
    const form = new FormData()
    form.append("image", input.file)
    form.append("name", input.name)
    form.append("aliases", JSON.stringify(input.aliases))
    return apiRequest<CustomEmojiDto>("/emojis", { method: "POST", body: form })
  },

  async updateCustomEmoji(
    id: string,
    patch: { name?: string; aliases?: string[] },
  ): Promise<CustomEmojiDto> {
    return apiRequest<CustomEmojiDto>(`/admin/emojis/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    })
  },

  async deleteCustomEmoji(id: string): Promise<void> {
    await apiRequest<{ status: string }>(`/admin/emojis/${id}`, { method: "DELETE" })
  },

  getCustomEmojiImageUrl(emoji: CustomEmojiDto): string {
    if (emoji.image_url.startsWith("/api/")) {
      return `${API_BASE}${emoji.image_url.slice("/api".length)}`
    }
    return resolveUrl(emoji.image_url)
  },

  async deleteSoundboardSound(id: string): Promise<void> {
    await apiRequest<{ status: string }>(`/admin/soundboard/${id}`, { method: "DELETE" })
  },

  async replaceSoundboardAudio(id: string, file: File): Promise<SoundboardSound> {
    const form = new FormData()
    form.append("audio", file)
    return apiRequest<SoundboardSound>(`/admin/soundboard/${id}/audio`, {
      method: "PUT",
      body: form,
    })
  },

  // audio_url from the backend is "/api/...?v=<version>": resolve it against
  // API_BASE so it also works in Electron and with a non-default backend
  // origin. The version changes when the audio is replaced (it is cached as
  // immutable).
  getSoundboardAudioUrl(sound: SoundboardSound): string {
    if (sound.audio_url?.startsWith("/api/")) {
      return `${API_BASE}${sound.audio_url.slice("/api".length)}`
    }
    return `${API_BASE}/soundboard/${sound.id}/audio`
  },

  // ===== Remote Stats Collection API (super_admin only) =====
  async enableRoomStats(roomId: string): Promise<{ status: string; message: string }> {
    return apiRequest<{ status: string; message: string }>(`/admin/stats/rooms/${roomId}/enable`, {
      method: "POST",
    })
  },

  async disableRoomStats(roomId: string): Promise<{ status: string; message: string }> {
    return apiRequest<{ status: string; message: string }>(`/admin/stats/rooms/${roomId}/disable`, {
      method: "POST",
    })
  },

  async subscribeRoomStats(roomId: string): Promise<{ status: string; message: string }> {
    return apiRequest<{ status: string; message: string }>(
      `/admin/stats/rooms/${roomId}/subscribe`,
      {
        method: "POST",
      },
    )
  },

  async unsubscribeRoomStats(roomId: string): Promise<{ status: string; message: string }> {
    return apiRequest<{ status: string; message: string }>(
      `/admin/stats/rooms/${roomId}/unsubscribe`,
      {
        method: "POST",
      },
    )
  },

  async getStatsStatus(): Promise<StatsStatus[]> {
    return apiRequest<StatsStatus[]>("/admin/stats/status")
  },

  // ===== Usage Analytics API (super_admin only) =====
  async getAnalyticsReport(): Promise<AnalyticsReport> {
    return apiRequest<AnalyticsReport>("/admin/analytics/report")
  },

  // ===== Security self-check API (super_admin only) =====
  async getSecuritySelfCheck(): Promise<SecuritySelfCheckReport> {
    return apiRequest<SecuritySelfCheckReport>("/admin/self-check")
  },
}

// Utility functions
export const generateUserId = (): string => {
  return Math.random().toString(36).substr(2, 12) + Date.now().toString(36)
}

export const generateNickname = (userId?: string): string => {
  if (userId) {
    return `User-${userId.substr(0, 6)}`
  }
  return `User-${Math.random().toString(36).substr(2, 6)}`
}
