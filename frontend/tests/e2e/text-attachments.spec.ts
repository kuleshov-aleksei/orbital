import { test, expect } from "@playwright/test"
import { ADMIN_EMAIL, TEST_PASSWORD, deleteRoom, ensureAdmin, loginViaUi } from "./_helpers"

const BACKEND_URL = "http://127.0.0.1:8080"

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

    // A noisy 3000x200 PNG, wider than the 2560 px storage cap.
    const wide = await page.evaluate(async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 3000
      canvas.height = 200
      const ctx = canvas.getContext("2d")!
      const data = ctx.createImageData(3000, 200)
      for (let i = 0; i < data.data.length; i++) data.data[i] = (i * 2654435761) >>> 24
      ctx.putImageData(data, 0, 0)
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ""
      for (const b of bytes) bin += String.fromCharCode(b)
      return btoa(bin)
    })

    // Upload through the hidden input, then send an attachment-only message.
    await page
      .getByTestId("attach-input")
      .setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: Buffer.from(wide, "base64") })
    const chip = page.getByTestId("composer-upload")
    await expect(chip).toHaveCount(1)
    // Enter while uploading only shows "Wait for the uploads to finish".
    await expect(chip.getByRole("progressbar")).toHaveCount(0)
    await expect(chip).not.toContainText("Retry")
    // HD on and off again: each switch drops the upload and sends it anew.
    const hd = chip.getByTestId("composer-upload-hd")
    await expect(hd).toHaveAttribute("title", /^Compressed/)
    await hd.click()
    await expect(hd).toHaveAttribute("aria-pressed", "true")
    await expect(chip.getByRole("progressbar")).toHaveCount(0)
    await hd.click()
    await expect(hd).toHaveAttribute("aria-pressed", "false")
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
    // Stored compressed: WebP, scaled down to the 2560 px cap.
    const original = page.getByTestId("attachment-lightbox").locator('img[alt="wide.webp"]')
    await expect(original).toHaveJSProperty("complete", true)
    expect(await original.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(2560)
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("attachment-lightbox")).toHaveCount(0)

    // Protect from the context menu: the lock badge comes back via the socket.
    await tile.click({ button: "right" })
    await page.getByTestId("attachment-protect").click()
    await expect(page.getByLabel("Protected from auto-removal")).toBeVisible()

    // The storage page lists the file as protected.
    const files = await page.context().newPage()
    await files.goto("/files")
    const row = files.getByTestId("my-file-row").filter({ hasText: "wide.webp" })
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

test("crop/rotate an image and send it as a spoiler", async ({ page, request }) => {
  const health = await (await request.get(`${BACKEND_URL}/api/health`)).text()
  test.skip(!health.includes('"text_channels":"ok"'), "text channels are off (make meili-up)")
  const config = (await (await request.get(`${BACKEND_URL}/api/config`)).json()) as {
    attachments?: unknown
  }
  test.skip(!config.attachments, "attachments are off (make garage-up, GARAGE_DEFAULT_* in .env)")

  const admin = await ensureAdmin(request)
  const name = `e2e-spoiler-${Date.now().toString(36)}`
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

    // A 300x200 PNG.
    const png = await page.evaluate(async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 300
      canvas.height = 200
      const ctx = canvas.getContext("2d")!
      ctx.fillStyle = "#3a7"
      ctx.fillRect(0, 0, 300, 200)
      ctx.fillStyle = "#e33"
      ctx.fillRect(0, 0, 150, 100)
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ""
      for (const b of bytes) bin += String.fromCharCode(b)
      return btoa(bin)
    })
    await page
      .getByTestId("attach-input")
      .setInputFiles({ name: "pic.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") })
    const chip = page.getByTestId("composer-upload")
    await expect(chip.getByRole("progressbar")).toHaveCount(0)

    // Rotate right (200x300), then a 1:1 crop (200x200).
    await chip.getByTestId("composer-upload-edit").click()
    const editor = page.getByTestId("image-edit-modal")
    await expect(editor).toBeVisible()
    await editor.getByTestId("image-edit-rotate-right").click()
    await editor.getByTestId("image-edit-ratio-1:1").click()
    await expect(editor).toContainText("200 × 200")
    await editor.getByTestId("image-edit-apply").click()
    await expect(editor).toHaveCount(0)
    await expect(chip).toContainText("Edited")
    await expect(chip.getByRole("progressbar")).toHaveCount(0)
    await expect(chip).not.toContainText("Retry")

    await chip.getByTestId("composer-upload-spoiler").click()
    await expect(chip.getByTestId("composer-upload-spoiler")).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await page.getByTestId("text-composer").press("Enter")
    await expect(page.getByTestId("composer-upload")).toHaveCount(0)

    // The sent tile is hidden until clicked; the first click only reveals it.
    const tile = page.getByTestId("text-message").getByTestId("attachment-image")
    await expect(tile).toHaveAttribute("data-spoiler", "hidden")
    await expect(tile.getByTestId("attachment-spoiler")).toBeVisible()
    // The server-side copy carries the crop.
    await expect(tile).toHaveAttribute("style", /aspect-ratio: 200 \/ 200/)
    await tile.click()
    await expect(tile).not.toHaveAttribute("data-spoiler", "hidden")
    await expect(page.getByTestId("attachment-lightbox")).toHaveCount(0)
    await tile.click()
    await expect(page.getByTestId("attachment-lightbox")).toBeVisible()
  } finally {
    await deleteRoom(request, room.id, admin.token)
  }
})
