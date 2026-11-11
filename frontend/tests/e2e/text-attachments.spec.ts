import { test, expect } from "@playwright/test"
import { ADMIN_EMAIL, TEST_PASSWORD, deleteRoom, ensureAdmin, loginViaUi } from "./_helpers"

const BACKEND_URL = "http://127.0.0.1:8080"

// 1x1 PNG: real image bytes for the backend sniffer and thumbnailer.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

// Attachments (docs/specs/CHAT_SYSTEM.md §7.12) need Meilisearch (make meili-up)
// and the dev Garage (make garage-up, GARAGE_DEFAULT_* in .env). The test skips
// when the backend runs without them, e.g. in the Docker runner.
test("attach an image, view, protect, list on /files, delete", async ({ page, request }) => {
  const health = await (await request.get(`${BACKEND_URL}/api/health`)).text()
  test.skip(!health.includes('"text_channels":"ok"'), "text channels are off (make meili-up)")
  const config = (await (await request.get(`${BACKEND_URL}/api/config`)).json()) as {
    attachments?: unknown
  }
  test.skip(!config.attachments, "attachments are off (make garage-up, GARAGE_DEFAULT_* in .env)")

  const admin = await ensureAdmin(request)
  const name = `e2e-files-${Date.now().toString(36)}`
  const res = await request.post(`${BACKEND_URL}/api/rooms`, {
    data: { name, type: "text", max_users: 10 },
    headers: { Authorization: `Bearer ${admin.token}` },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  const room = (await res.json()) as { id: string }

  try {
    await loginViaUi(page, ADMIN_EMAIL, TEST_PASSWORD)
    await page.locator(".room-card").filter({ hasText: name }).click()
    await expect(page.getByTestId("text-channel-view")).toBeVisible()

    // Upload through the hidden input, then send an attachment-only message.
    await page
      .getByTestId("attach-input")
      .setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG })
    const chip = page.getByTestId("composer-upload")
    await expect(chip).toHaveCount(1)
    // Enter while uploading only shows "Wait for the uploads to finish".
    await expect(chip.getByRole("progressbar")).toHaveCount(0)
    await expect(chip).not.toContainText("Retry")
    await page.getByTestId("text-composer").press("Enter")
    await expect(page.getByTestId("composer-upload")).toHaveCount(0)

    // The image loads from a presigned S3 URL, never from /api/.
    const tile = page.getByTestId("text-message").getByTestId("attachment-image")
    await expect(tile).toBeVisible()
    const img = tile.locator("img")
    await expect(img).toHaveJSProperty("complete", true)
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    expect(await img.getAttribute("src")).not.toContain("/api/")

    await tile.click()
    await expect(page.getByTestId("attachment-lightbox")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("attachment-lightbox")).toHaveCount(0)

    // Protect from the context menu: the lock badge comes back via the socket.
    await tile.click({ button: "right" })
    await page.getByTestId("attachment-protect").click()
    await expect(page.getByLabel("Protected from auto-removal")).toBeVisible()

    // The storage page lists the file as protected.
    const files = await page.context().newPage()
    await files.goto("/files")
    const row = files.getByTestId("my-file-row").filter({ hasText: "dot.png" })
    await expect(row).toHaveCount(1)
    await files.close()

    // Delete (two clicks to confirm): the message keeps a tombstone.
    await tile.click({ button: "right" })
    await page.getByTestId("attachment-delete").click()
    await page.getByTestId("attachment-delete").click()
    await expect(page.getByTestId("attachment-tombstone")).toContainText("removed (by uploader)")
    await expect(page.getByTestId("attachment-image")).toHaveCount(0)
  } finally {
    await deleteRoom(request, room.id, admin.token)
  }
})
