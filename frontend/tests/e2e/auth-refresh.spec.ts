import { test, expect } from "@playwright/test"
import { ensureAdmin, injectSession, type TestUser } from "./_helpers"

const BACKEND_URL = "http://127.0.0.1:8080"

// A throwaway user object for scenarios that only need localStorage seeded with
// a deliberately broken token (never registered against the backend).
function fakeUser(overrides: Partial<TestUser>): TestUser {
  return {
    id: "fake-user",
    nickname: "FakeUser",
    email: "fake@orbital-e2e.test",
    password: "",
    token: "",
    role: "user",
    isGuest: false,
    authProvider: "password",
    ...overrides,
  }
}

test.describe("JWT refresh lifecycle", () => {
  // This spec runs first on a fresh e2e DB, where the first registered account
  // is promoted to super_admin (other specs rely on that). Claim the admin slot
  // here so registering a throwaway user never steals it.
  test("refresh endpoint issues a new working token", async ({ request }) => {
    const user = await ensureAdmin(request)

    const res = await request.post(`${BACKEND_URL}/api/auth/refresh`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
    expect(res.ok()).toBeTruthy()

    const data = (await res.json()) as {
      token: string
      expires_at: string
      user: { id: string }
    }
    expect(data.token).toBeTruthy()
    expect(data.expires_at).toBeTruthy()
    expect(data.user.id).toBe(user.id)

    // The refreshed token authenticates against a protected endpoint.
    const me = await request.get(`${BACKEND_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${data.token}` },
    })
    expect(me.ok()).toBeTruthy()
  })

  test("refresh endpoint rejects missing and invalid tokens", async ({ request }) => {
    const missing = await request.post(`${BACKEND_URL}/api/auth/refresh`)
    expect(missing.status()).toBe(401)

    const invalid = await request.post(`${BACKEND_URL}/api/auth/refresh`, {
      headers: { Authorization: "Bearer not-a-real-jwt" },
    })
    expect(invalid.status()).toBe(401)
  })

  test("proactively refreshes a session nearing expiry on load", async ({ browser, request }) => {
    const user = await ensureAdmin(request)

    // Expiry inside the 7-day refresh window (but not yet expired) so the app
    // slides the token forward on startup.
    const seededExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const ctx = await browser.newContext()
    await injectSession(ctx, user, { tokenExpiresAt: seededExpiry })
    const page = await ctx.newPage()

    const refreshResponse = page.waitForResponse(
      (resp) => resp.url().includes("/api/auth/refresh") && resp.request().method() === "POST",
    )

    await page.goto("/")

    const resp = await refreshResponse
    expect(resp.ok()).toBeTruthy()

    // The persisted expiry slides forward well past the seeded one, and the
    // session stays authenticated (no bounce back to the auth view).
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => localStorage.getItem("orbital_token_expires_at"))
        return raw ? Date.parse(raw) : 0
      })
      .toBeGreaterThan(Date.parse(seededExpiry))

    await expect(page.getByTestId("auth-tab-password")).toBeHidden()

    await ctx.close()
  })

  test("shows the session-expired notice when the token is already expired", async ({ browser }) => {
    const ctx = await browser.newContext()
    await injectSession(
      ctx,
      fakeUser({ id: "expired-user", nickname: "ExpiredUser", token: "expired.jwt.token" }),
      { tokenExpiresAt: new Date(Date.now() - 60 * 1000).toISOString() },
    )
    const page = await ctx.newPage()
    await page.goto("/")

    await expect(page.getByTestId("session-expired-notice")).toBeVisible()
    await expect(page.getByTestId("auth-tab-password")).toBeVisible()

    await ctx.close()
  })

  test("shows the session-expired notice when a rejected token cannot be refreshed", async ({
    browser,
  }) => {
    const ctx = await browser.newContext()
    // Token is invalid but the stored expiry is far in the future, so the
    // proactive path is skipped and the 401 interceptor must handle it.
    await injectSession(
      ctx,
      fakeUser({ id: "invalid-user", nickname: "InvalidUser", token: "invalid.jwt.token" }),
      { tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() },
    )
    const page = await ctx.newPage()
    await page.goto("/")

    await expect(page.getByTestId("session-expired-notice")).toBeVisible()
    await expect(page.getByTestId("auth-tab-password")).toBeVisible()

    await ctx.close()
  })
})
