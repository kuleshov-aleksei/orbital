import { test, expect } from "@playwright/test"
import type { Page, WebSocketRoute } from "@playwright/test"
import { ADMIN_EMAIL, TEST_PASSWORD, deleteRoom, ensureAdmin, loginViaUi } from "./_helpers"

const BACKEND_URL = "http://127.0.0.1:8080"

/**
 * Makes the server unreachable for one page without touching the page itself
 * (the Vite bundle keeps loading, like the APK-bundled Android app): /api
 * requests fail at the network level and app sockets are dropped and refused.
 */
async function installServerSwitch(page: Page) {
  let down = false
  const sockets = new Set<WebSocketRoute>()

  await page.route("**/api/**", (route) =>
    down ? route.abort("internetdisconnected") : route.continue(),
  )
  await page.routeWebSocket(
    (url) => url.pathname === "/ws" || url.pathname.startsWith("/ws/"),
    (ws) => {
      if (down) {
        void ws.close({ code: 1006, reason: "offline" }).catch(() => {})
        return
      }
      sockets.add(ws)
      ws.connectToServer()
    },
  )

  return {
    async setDown(value: boolean) {
      down = value
      if (!value) return
      for (const ws of sockets) await ws.close({ code: 1006, reason: "offline" }).catch(() => {})
      sockets.clear()
    },
  }
}

/** Channel snapshots written to IndexedDB (services/offlineCache.ts). */
async function cachedChannelCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("orbital-cache")
        open.onerror = () => resolve(0)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("channels")) return resolve(0)
          const req = db.transaction("channels").objectStore("channels").count()
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(0)
        }
      }),
  )
}

// Text channels need Meilisearch (make meili-up); skipped without it.
test("offline: cached channel, queued messages, delivered once on reconnect", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  const health = await (await request.get(`${BACKEND_URL}/api/health`)).text()
  test.skip(!health.includes('"text_channels":"ok"'), "text channels are off (make meili-up)")

  const admin = await ensureAdmin(request)
  const name = `e2e-offline-${Date.now().toString(36)}`
  const res = await request.post(`${BACKEND_URL}/api/rooms`, {
    data: { name, type: "text", max_users: 10 },
    headers: { Authorization: `Bearer ${admin.token}` },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  const room = (await res.json()) as { id: string }

  const server = await installServerSwitch(page)
  const messages = page.getByTestId("text-message")
  const queued = page.getByTestId("queued-message")
  const composer = page.getByTestId("text-composer")
  const roomCard = page.locator(".room-card").filter({ hasText: name })

  try {
    // Online: one message, which lands in the offline cache.
    await loginViaUi(page, ADMIN_EMAIL, TEST_PASSWORD)
    await roomCard.click()
    await expect(page.getByTestId("text-channel-view")).toBeVisible()
    await composer.fill("sent while online")
    await composer.press("Enter")
    await expect(messages.filter({ hasText: "sent while online" })).toHaveCount(1)
    await expect.poll(() => cachedChannelCount(page)).toBeGreaterThan(0)

    // The server goes away: the indicator says so and new messages queue.
    await server.setDown(true)
    await expect(page.getByTestId("connection-status")).toContainText("Offline", {
      timeout: 20_000,
    })
    await expect(page.getByTestId("attach-button")).toBeDisabled()
    for (const text of ["queued one", "queued two"]) {
      await composer.fill(text)
      await composer.press("Enter")
    }
    await expect(queued).toHaveCount(2)

    // A cold start while offline shows the cached channel and the outbox.
    await page.reload()
    await expect(roomCard).toBeVisible()
    await roomCard.click()
    await expect(messages.filter({ hasText: "sent while online" })).toHaveCount(1)
    await expect(queued).toHaveCount(2)

    // Back online: the queue drains, oldest first, each message exactly once.
    await server.setDown(false)
    await expect(page.getByTestId("connection-status")).toHaveCount(0, { timeout: 30_000 })
    await expect(queued).toHaveCount(0, { timeout: 15_000 })

    const history = await request.get(`${BACKEND_URL}/api/rooms/${room.id}/messages?limit=50`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    })
    expect(history.ok(), await history.text()).toBeTruthy()
    const page_ = (await history.json()) as { messages: { content: string }[] }
    expect(page_.messages.map((m) => m.content)).toEqual([
      "sent while online",
      "queued one",
      "queued two",
    ])
  } finally {
    await server.setDown(false)
    await deleteRoom(request, room.id, admin.token)
  }
})
