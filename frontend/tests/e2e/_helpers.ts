import { expect } from "@playwright/test"
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test"

const BACKEND_URL = "http://127.0.0.1:8080"
const LIVEKIT_URL = "http://127.0.0.1:7880"

export const ADMIN_EMAIL = "admin@orbital-e2e.test"
export const ADMIN_NICKNAME = "E2EAdmin"
export const TEST_PASSWORD = "E2Epassw0rd!"

export interface TestUser {
  id: string
  nickname: string
  email: string
  password: string
  token: string
  role: string
  isGuest: boolean
  authProvider: string
}

interface AuthResponse {
  token: string
  user: {
    id: string
    nickname: string
    role: string
    email?: string
    is_guest?: boolean
    auth_provider?: string
  }
}

function toTestUser(data: AuthResponse, email: string, password: string): TestUser {
  return {
    id: data.user.id,
    nickname: data.user.nickname,
    email: data.user.email || email,
    password,
    token: data.token,
    role: data.user.role || "user",
    isGuest: data.user.is_guest ?? false,
    authProvider: data.user.auth_provider || "password",
  }
}

async function login(
  request: APIRequestContext,
  login: string,
  password: string,
): Promise<TestUser | null> {
  const res = await request.post(`${BACKEND_URL}/api/auth/login`, {
    data: { login, password },
  })

  if (!res.ok()) {
    return null
  }

  const data = (await res.json()) as AuthResponse
  return toTestUser(data, login, password)
}

async function register(
  request: APIRequestContext,
  email: string,
  nickname: string,
  password: string,
): Promise<TestUser | null> {
  const res = await request.post(`${BACKEND_URL}/api/auth/register`, {
    data: { email, nickname, password },
  })

  if (!res.ok()) {
    return null
  }

  const data = (await res.json()) as AuthResponse
  return toTestUser(data, email, password)
}

// The register endpoint stamps `role` into the JWT before the first-user
// super_admin promotion runs, so the register token never carries the admin
// role. Log back in to obtain a token that actually passes RequireAdmin.
export async function ensureAdmin(request: APIRequestContext): Promise<TestUser> {
  const registered = await register(request, ADMIN_EMAIL, ADMIN_NICKNAME, TEST_PASSWORD)
  if (registered) {
    const relogin = await login(request, ADMIN_EMAIL, TEST_PASSWORD)
    if (relogin) {
      return relogin
    }
    return registered
  }

  const existing = await login(request, ADMIN_EMAIL, TEST_PASSWORD)
  if (existing) {
    return existing
  }

  throw new Error("Failed to register or login as the E2E admin user")
}

export async function ensureUser(
  request: APIRequestContext,
  opts: { email: string; nickname: string; password?: string },
): Promise<TestUser> {
  const password = opts.password ?? TEST_PASSWORD

  const registered = await register(request, opts.email, opts.nickname, password)
  if (registered) {
    return registered
  }

  const existing = await login(request, opts.email, password)
  if (existing) {
    return existing
  }

  // Login by nickname as a fallback: nicknames are globally unique on the
  // backend, so a previously-registered user may share this nickname.
  const byNickname = await login(request, opts.nickname, password)
  if (byNickname && byNickname.email !== opts.email) {
    throw new Error(
      `Nickname "${opts.nickname}" is already taken by another account (${byNickname.email}). ` +
        `Test nicknames must be unique across the e2e run.`,
    )
  }

  throw new Error(
    `Failed to register or login test user ${opts.nickname} (${opts.email}). ` +
      `Try a fresh e2e database, or pick a unique nickname.`,
  )
}

export async function loginViaUi(page: Page, login: string, password: string) {
  await page.goto("/")
  await page.getByTestId("auth-tab-password").click()
  await page.locator("#login").fill(login)
  await page.locator("#password").fill(password)
  await page.locator('form button[type="submit"]').click()
  await expect(page.getByTestId("welcome-view")).toBeVisible()
}

export function injectSession(context: BrowserContext, user: TestUser) {
  return setUserIdentity(context, {
    id: user.id,
    nickname: user.nickname,
    token: user.token,
    authProvider: user.authProvider,
    isGuest: user.isGuest,
    role: user.role,
  })
}

// LiveKit answers unknown paths (e.g. GET /) with an HTTP 4xx, so any
// response proves the server is reachable; a connection error means it's down.
export async function assertLiveKitRunning(request: APIRequestContext) {
  let reachable = false
  try {
    const res = await request.get(`${LIVEKIT_URL}/`)
    reachable = res.status() >= 200 && res.status() < 500
  } catch {
    reachable = false
  }

  if (!reachable) {
    throw new Error(
      `LiveKit server is not reachable at ${LIVEKIT_URL}. Start it with:\n` +
        "  livekit-server --config ../livekit/livekit-dev.yaml",
    )
  }
}

export async function deleteRoom(request: APIRequestContext, roomId: string, token: string) {
  const res = await request.delete(`${BACKEND_URL}/api/rooms/${roomId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) {
    throw new Error(`Failed to delete room: ${res.status()} ${await res.text()}`)
  }
}

export async function registerUser(
  request: APIRequestContext,
  email: string,
  nickname: string,
  password: string,
) {
  const user = await register(request, email, nickname, password)
  if (!user) {
    throw new Error(`Failed to register user: ${email}`)
  }
  return { token: user.token, user: { id: user.id, nickname: user.nickname } }
}

export async function guestLogin(request: APIRequestContext) {
  const res = await request.post(`${BACKEND_URL}/api/auth/guest`)

  if (!res.ok()) {
    throw new Error(`Failed to guest login: ${res.status()} ${await res.text()}`)
  }

  return (await res.json()) as AuthResponse
}

export async function loginUser(
  request: APIRequestContext,
  login: string,
  password: string,
): Promise<TestUser | null> {
  return login(request, login, password)
}

export async function createCategory(request: APIRequestContext, token: string, name: string) {
  const res = await request.post(`${BACKEND_URL}/api/categories`, {
    data: { name },
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok()) {
    throw new Error(`Failed to create category: ${res.status()} ${await res.text()}`)
  }

  return (await res.json()) as { id: string; name: string }
}

export async function seedRoom(
  request: APIRequestContext,
  token: string,
  room: { name: string; category?: string; maxUsers?: number },
) {
  const res = await request.post(`${BACKEND_URL}/api/rooms`, {
    data: {
      name: room.name,
      category: room.category ?? "General",
      max_users: room.maxUsers ?? 10,
    },
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok()) {
    throw new Error(`Failed to create room: ${res.status()} ${await res.text()}`)
  }

  return (await res.json()) as { id: string; name: string }
}

export async function setUserIdentity(
  context: BrowserContext,
  user: {
    id: string
    nickname: string
    token?: string
    authProvider?: string
    isGuest?: boolean
    role?: string
  },
) {
  await context.addInitScript(({ id, nickname, token, authProvider, isGuest, role }) => {
    localStorage.setItem("orbital_user_id", id)
    localStorage.setItem("orbital_user_nickname", nickname)
    localStorage.setItem("orbital_has_completed_auth", "true")
    if (token) {
      localStorage.setItem("orbital_auth_token", token)
      localStorage.setItem("orbital_user_auth_provider", authProvider || "guest")
      localStorage.setItem("orbital_user_is_guest", isGuest ? "true" : "false")
      localStorage.setItem("orbital_user_role", role || "user")
    }
  }, user)
}