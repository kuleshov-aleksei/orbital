import type { APIRequestContext, BrowserContext } from "@playwright/test"

const BACKEND_URL = "http://127.0.0.1:8080"

let authToken: string | null = null

export function setAuthToken(token: string) {
  authToken = token
}

export async function resetBackend(request: APIRequestContext) {
  authToken = null
  const res = await request.post(`${BACKEND_URL}/api/test/reset`, {
    headers: {
      "X-Orbital-E2E": "1",
    },
  })
  if (!res.ok()) {
    if (res.status() === 404) {
      throw new Error(
        `Failed to reset backend: 404 ${await res.text()}\n` +
          `The backend on ${BACKEND_URL} does not expose /api/test/reset. ` +
          `Stop any running backend on :8080 and rerun Playwright so it can start the test backend.`,
      )
    }
    throw new Error(`Failed to reset backend: ${res.status()} ${await res.text()}`)
  }
}

export async function registerUser(request: APIRequestContext, email: string, nickname: string, password: string) {
  const res = await request.post(`${BACKEND_URL}/api/auth/register`, {
    data: { email, nickname, password },
  })

  if (!res.ok()) {
    throw new Error(`Failed to register user: ${res.status()} ${await res.text()}`)
  }

  const data = (await res.json()) as { token: string; user: { id: string; nickname: string } }
  authToken = data.token
  return data
}

export async function guestLogin(request: APIRequestContext) {
  const res = await request.post(`${BACKEND_URL}/api/auth/guest`)

  if (!res.ok()) {
    throw new Error(`Failed to guest login: ${res.status()} ${await res.text()}`)
  }

  const data = (await res.json()) as { token: string; user: { id: string; nickname: string } }
  authToken = data.token
  return data
}

export async function loginUser(request: APIRequestContext, login: string, password: string) {
  const res = await request.post(`${BACKEND_URL}/api/auth/login`, {
    data: { login, password },
  })

  if (!res.ok()) {
    return null
  }

  const data = (await res.json()) as { token: string; user: { id: string; nickname: string } }
  authToken = data.token
  return data
}

export async function createCategory(request: APIRequestContext, name: string) {
  const headers: Record<string, string> = {}
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`
  }
  const res = await request.post(`${BACKEND_URL}/api/categories`, {
    data: { name },
    headers,
  })

  if (!res.ok()) {
    throw new Error(`Failed to create category: ${res.status()} ${await res.text()}`)
  }

  return (await res.json()) as { id: string; name: string }
}

export async function seedRoom(
  request: APIRequestContext,
  room: { name: string; category?: string; maxUsers?: number },
) {
  const headers: Record<string, string> = {}
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`
  }
  const res = await request.post(`${BACKEND_URL}/api/rooms`, {
    data: {
      name: room.name,
      category: room.category ?? "General",
      max_users: room.maxUsers ?? 10,
    },
    headers,
  })

  if (!res.ok()) {
    throw new Error(`Failed to create room: ${res.status()} ${await res.text()}`)
  }

  return (await res.json()) as { id: string; name: string }
}

export async function setUserIdentity(
  context: BrowserContext,
  user: { id: string; nickname: string; token?: string; authProvider?: string; isGuest?: boolean; role?: string },
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