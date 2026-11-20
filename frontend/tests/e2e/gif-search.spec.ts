import { test, expect } from "@playwright/test"
import type { APIRequestContext } from "@playwright/test"
import { ADMIN_EMAIL, TEST_PASSWORD, deleteRoom, ensureAdmin, loginViaUi } from "./_helpers"

const BACKEND_URL = "http://127.0.0.1:8080"
const POSTER = "https://static.klipy.com/ii/e2e/aa/poster.jpg"
const PLAYBACK = "https://static.klipy.com/ii/e2e/aa/clip.mp4"

// A 1x1 transparent PNG: the provider CDN is never contacted in CI.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0m0AAAAASUVORK5CYII=",
  "base64",
)

const KLIPY_PAGE = {
  result: true,
  data: {
    data: [
      {
        id: 8041071659142944,
        slug: "hello-hi",
        title: "Hello",
        type: "gif",
        file: {
          md: {
            mp4: { url: PLAYBACK, width: 498, height: 498, size: 119294 },
            gif: { url: `${PLAYBACK}.gif`, width: 498, height: 498, size: 3721260 },
            jpg: { url: POSTER, width: 498, height: 498, size: 20086 },
          },
          sm: {
            webp: { url: `${PLAYBACK}.webp`, width: 320, height: 320, size: 48827 },
            jpg: { url: POSTER, width: 220, height: 220, size: 8560 },
          },
        },
      },
    ],
    current_page: 1,
    per_page: 24,
    has_next: false,
  },
}

async function createTextRoom(request: APIRequestContext, token: string) {
  const name = `e2e-gif-${Date.now().toString(36)}`
  const res = await request.post(`${BACKEND_URL}/api/rooms`, {
    data: { name, type: "text", max_users: 10 },
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return { name, room: (await res.json()) as { id: string } }
}

// GIF search (docs/specs/CHAT_SYSTEM.md §7.17) runs in the client, so the
// provider is mocked here; the backend only stores the reference.
test("send a GIF from the picker", async ({ page, request }) => {
  const health = await (await request.get(`${BACKEND_URL}/api/health`)).text()
  test.skip(!health.includes('"text_channels":"ok"'), "text channels are off (make meili-up)")

  const admin = await ensureAdmin(request)
  const { name, room } = await createTextRoom(request, admin.token)
  try {
    // The app learns that GIF search is on from /api/config (no key there),
    // then fetches the client key. Both are mocked: CI has no provider key.
    await page.route("**/api/config", async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as Record<string, unknown>
      await route.fulfill({ response, json: { ...body, gif_provider: "klipy" } })
    })
    await page.route("**/api/chat/gif-config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: "klipy", api_key: "e2e-key", rating: "pg-13" }),
      }),
    )
    await page.route("https://api.klipy.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(KLIPY_PAGE) }),
    )
    await page.route("https://static.klipy.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
    )

    await loginViaUi(page, ADMIN_EMAIL, TEST_PASSWORD)
    await page.locator(".room-card").filter({ hasText: name }).click()
    await expect(page.getByTestId("text-channel-view")).toBeVisible()

    const button = page.getByTestId("gif-button")
    await expect(button).toBeVisible()
    await button.click()

    // The required KLIPY attribution: the placeholder and the wordmark.
    await expect(page.getByTestId("gif-search")).toHaveAttribute("placeholder", "Search KLIPY")
    await expect(page.getByTestId("gif-attribution-logo")).toBeVisible()
    const result = page.getByTestId("gif-result").first()
    await expect(result).toBeVisible()
    await result.click()

    // The pick is a chip above the composer until the message is sent.
    await expect(page.getByTestId("composer-gif")).toBeVisible()
    await expect(page.getByTestId("gif-picker")).toHaveCount(0)
    await page.getByTestId("text-composer").press("Enter")
    await expect(page.getByTestId("composer-gif")).toHaveCount(0)

    const gif = page.getByTestId("message-gif")
    await expect(gif).toBeVisible()
    await expect(gif.getByTestId("message-gif-media")).toHaveAttribute("src", PLAYBACK)

    // Persisted: the reference comes back from Meilisearch, not from the UI.
    const res = await request.get(`${BACKEND_URL}/api/rooms/${room.id}/messages`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
    const body = (await res.json()) as { messages: { gif?: { id?: string; provider?: string } }[] }
    const stored = body.messages.find((m) => m.gif?.id === "8041071659142944")
    expect(stored?.gif?.provider).toBe("klipy")
  } finally {
    await deleteRoom(request, room.id, admin.token)
  }
})

test("no GIF button when the server has no provider key", async ({ page, request }) => {
  const health = await (await request.get(`${BACKEND_URL}/api/health`)).text()
  test.skip(!health.includes('"text_channels":"ok"'), "text channels are off (make meili-up)")

  const admin = await ensureAdmin(request)
  const { name, room } = await createTextRoom(request, admin.token)
  try {
    // No gif_provider in /api/config: the composer must not offer GIF search,
    // and no provider key is requested.
    await loginViaUi(page, ADMIN_EMAIL, TEST_PASSWORD)
    await page.locator(".room-card").filter({ hasText: name }).click()
    await expect(page.getByTestId("text-channel-view")).toBeVisible()
    await expect(page.getByTestId("text-composer")).toBeVisible()
    await expect(page.getByTestId("gif-button")).toHaveCount(0)
  } finally {
    await deleteRoom(request, room.id, admin.token)
  }
})
