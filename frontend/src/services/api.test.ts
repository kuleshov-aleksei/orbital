import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  apiRequest,
  apiService,
  clearAuthToken,
  getTokenExpiry,
  isTokenExpired,
  setAuthToken,
  setOnSessionExpired,
  setTokenExpiry,
  tokenNeedsRefresh,
} from "./api"
import { setOnClientOutdated } from "./appVersion"

const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  clearAuthToken()
})

afterEach(() => {
  setOnSessionExpired(null)
  setOnClientOutdated(null)
  clearAuthToken()
})

describe("token lifecycle", () => {
  it("expires inside the skew window and treats unknown expiry as valid", () => {
    // Legacy tokens without a stored expiry are the server's responsibility.
    expect(isTokenExpired()).toBe(false)
    expect(tokenNeedsRefresh()).toBe(false)

    setTokenExpiry(new Date(Date.now() + 30_000).toISOString())
    expect(isTokenExpired()).toBe(true)

    setTokenExpiry(inDays(6))
    expect(isTokenExpired()).toBe(false)
    expect(tokenNeedsRefresh()).toBe(true)

    setTokenExpiry(inDays(8))
    expect(tokenNeedsRefresh()).toBe(false)

    localStorage.setItem("orbital_token_expires_at", "not-a-date")
    expect(getTokenExpiry()).toBeNull()
    expect(isTokenExpired()).toBe(false)
  })
})

describe("apiRequest", () => {
  it("attaches auth and JSON headers but leaves multipart content type alone", async () => {
    setAuthToken("token-1")
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }))

    await apiRequest("/rooms")

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/rooms")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer token-1")
    expect(headers["Content-Type"]).toBe("application/json")

    fetchMock.mockClear()
    const form = new FormData()
    form.append("file", new Blob(["x"]), "sound.ogg")
    await apiRequest("/upload", { method: "POST", body: form })

    const formHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >
    expect(formHeaders["Content-Type"]).toBeUndefined()
  })

  it("refreshes once on 401 and retries with the new token", async () => {
    setAuthToken("old-token")
    fetchMock
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ token: "new-token", expires_at: inDays(60) }))
      .mockResolvedValueOnce(jsonResponse({ value: 42 }))

    const result = await apiRequest<{ value: number }>("/protected")

    expect(result).toEqual({ value: 42 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/refresh")

    const retryHeaders = (fetchMock.mock.calls[2][1] as RequestInit).headers as Record<
      string,
      string
    >
    expect(retryHeaders.Authorization).toBe("Bearer new-token")
  })

  it("never refreshes credential endpoints (a 401 there means bad credentials)", async () => {
    const sessionExpired = vi.fn()
    setOnSessionExpired(sessionExpired)
    fetchMock.mockResolvedValueOnce(new Response("invalid credentials", { status: 401 }))

    await expect(
      apiRequest("/auth/login", { method: "POST", body: JSON.stringify({}) }),
    ).rejects.toMatchObject({ message: "invalid credentials", status: 401 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sessionExpired).not.toHaveBeenCalled()
  })

  it("clears the session and notifies the app when a 401 cannot be refreshed", async () => {
    setAuthToken("expired-token")
    const sessionExpired = vi.fn()
    setOnSessionExpired(sessionExpired)
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 401 }))
      .mockResolvedValueOnce(new Response("refresh rejected", { status: 401 }))

    await expect(apiRequest("/protected")).rejects.toMatchObject({
      message: "Session expired",
      status: 401,
    })

    expect(sessionExpired).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem("orbital_auth_token")).toBeNull()
    expect(localStorage.getItem("orbital_token_expires_at")).toBeNull()
  })

  it("shares a single refresh between concurrent 401s", async () => {
    setAuthToken("old-token")
    let refreshCalls = 0
    const retried = new Set<string>()

    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1
        return jsonResponse({ token: "new-token", expires_at: inDays(60) })
      }
      if (!retried.has(url)) {
        retried.add(url)
        return new Response("expired", { status: 401 })
      }
      return jsonResponse({ ok: true })
    })

    await Promise.all([apiRequest("/rooms"), apiRequest("/categories")])

    expect(refreshCalls).toBe(1)
  })
})

describe("apiService payload contract", () => {
  it("sends snake_case room fields (backend ignores camelCase)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "room-1" }))

    await apiService.updateRoom("room-1", {
      name: "Renamed",
      max_users: 12,
      category: "cat-2",
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/rooms/room-1")
    expect((init as RequestInit).method).toBe("PUT")
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      name: "Renamed",
      max_users: 12,
      category: "cat-2",
    })
  })
})

describe("client version gate", () => {
  it("reports an outdated app on 426 instead of a session error", async () => {
    const outdated = vi.fn()
    const expired = vi.fn()
    setOnClientOutdated(outdated)
    setOnSessionExpired(expired)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "client_outdated", min_version: "1.6.0" }, 426),
    )

    await expect(apiRequest("/rooms")).rejects.toMatchObject({ status: 426 })
    expect(outdated).toHaveBeenCalledWith("1.6.0")
    expect(expired).not.toHaveBeenCalled()
  })

  it("treats other 426 bodies as a plain error", async () => {
    const outdated = vi.fn()
    setOnClientOutdated(outdated)
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 426 }))

    await expect(apiRequest("/rooms")).rejects.toMatchObject({ status: 426, message: "nope" })
    expect(outdated).not.toHaveBeenCalled()
  })

  it("does not identify the web app as a packaged client", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await apiRequest("/rooms")
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers["X-Orbital-Client"]).toBeUndefined()
  })
})
