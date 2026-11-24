import { test, expect } from "@playwright/test"
import type { APIRequestContext, Page } from "@playwright/test"
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
async function mockGifSearch(page: Page) {
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
}

test("send a GIF from the picker", async ({ page, request }) => {
  const health = await (await request.get(`${BACKEND_URL}/api/health`)).text()
  test.skip(!health.includes('"text_channels":"ok"'), "text channels are off (make meili-up)")

  const admin = await ensureAdmin(request)
  const { name, room } = await createTextRoom(request, admin.token)
  try {
    await mockGifSearch(page)

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

// Mobile layout: the pickers dock under the composer as one panel with an
// Emoji tab and a GIF tab (docs/specs/CHAT_SYSTEM.md §7.17).
test.describe("mobile composer pickers", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test("emoji and GIF share the dock under the composer", async ({ page, request }) => {
    const health = await (await request.get(`${BACKEND_URL}/api/health`)).text()
    test.skip(!health.includes('"text_channels":"ok"'), "text channels are off (make meili-up)")

    const admin = await ensureAdmin(request)
    const { name, room } = await createTextRoom(request, admin.token)
    try {
      await mockGifSearch(page)

      // The mobile layout lands on the room list, not the welcome view.
      await page.goto("/")
      await page.locator("#login").fill(ADMIN_EMAIL)
      await page.locator("#password").fill(TEST_PASSWORD)
      await page.locator('form button[type="submit"]').click()
      const card = page.locator(".room-card:visible").filter({ hasText: name })
      await card.click()
      await expect(page.getByTestId("text-channel-view")).toBeVisible()

      const list = page.getByTestId("text-message-list")
      const before = (await list.boundingBox())?.height ?? 0

      // Emoji button: the panel docks under the composer and pushes the chat up.
      await page.getByTestId("emoji-button").click()
      const dock = page.getByTestId("composer-dock")
      await expect(dock).toBeVisible()
      await expect(page.getByTestId("composer-tab-emoji")).toHaveAttribute(
        "aria-selected",
        "true",
      )
      const after = (await list.boundingBox())?.height ?? 0
      expect(after).toBeLessThan(before - 200)

      // Picking an emoji inserts it and keeps the dock open for more.
      await page.locator('[data-testid="emoji-picker"] .emoji-cell').first().click()
      await expect(page.getByTestId("text-composer")).not.toHaveValue("")
      await expect(dock).toHaveAttribute("aria-hidden", "false")

      // The GIF tab lives in the same dock (no floating popover).
      await page.getByTestId("composer-tab-gif").click()
      await expect(page.getByTestId("composer-tab-gif")).toHaveAttribute("aria-selected", "true")
      await expect(page.getByTestId("gif-search")).toHaveAttribute("placeholder", "Search KLIPY")
      await expect(page.getByTestId("gif-result").first()).toBeVisible()

      // A picked GIF closes the dock and waits in the composer.
      await page.getByTestId("gif-result").first().click()
      await expect(page.getByTestId("composer-gif")).toBeVisible()
      await expect.poll(async () => (await dock.boundingBox())?.height).toBe(0)
      await expect(page.getByTestId("emoji-button")).toHaveAttribute("aria-expanded", "false")

      // Opening with the GIF button starts on the GIF tab.
      await page.getByTestId("gif-button").click()
      await expect(page.getByTestId("composer-tab-gif")).toHaveAttribute("aria-selected", "true")
      await page.getByTestId("composer-picker-close").click()
      await expect.poll(async () => (await dock.boundingBox())?.height).toBe(0)

      // The handle drags the panel taller, over the chat …
      await page.getByTestId("emoji-button").click()
      const startHeight = (await dock.boundingBox())?.height ?? 0
      const handle = page.getByTestId("composer-dock-handle")
      const grip = (await handle.boundingBox())!
      const gripX = grip.x + grip.width / 2
      await page.mouse.move(gripX, grip.y + grip.height / 2)
      await page.mouse.down()
      await page.mouse.move(gripX, grip.y + grip.height / 2 - 120, { steps: 8 })
      await page.mouse.up()
      await expect
        .poll(async () => (await dock.boundingBox())?.height ?? 0)
        .toBeGreaterThan(startHeight + 80)

      // … and one long pull down dismisses it.
      const grown = (await dock.boundingBox())?.height ?? 0
      const grip2 = (await handle.boundingBox())!
      await page.mouse.move(grip2.x + grip2.width / 2, grip2.y + grip2.height / 2)
      await page.mouse.down()
      await page.mouse.move(grip2.x + grip2.width / 2, grip2.y + grip2.height / 2 + grown, {
        steps: 10,
      })
      await page.mouse.up()
      await expect.poll(async () => (await dock.boundingBox())?.height).toBe(0)
    } finally {
      await deleteRoom(request, room.id, admin.token)
    }
  })
})
