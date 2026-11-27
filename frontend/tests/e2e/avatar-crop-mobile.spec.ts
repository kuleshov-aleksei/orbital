import { test, expect } from "@playwright/test"
import type { Page } from "@playwright/test"
import { ADMIN_EMAIL, TEST_PASSWORD, ensureAdmin } from "./_helpers"

// A 600x400 PNG drawn in the page: big enough for the cropper's 128px minimum.
async function makePng(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas")
    canvas.width = 600
    canvas.height = 400
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#4f46e5"
    ctx.fillRect(0, 0, 600, 400)
    ctx.fillStyle = "#f59e0b"
    ctx.fillRect(200, 100, 200, 200)
    return canvas.toDataURL("image/png")
  })
  return Buffer.from(dataUrl.split(",")[1]!, "base64")
}

// The avatar editor must keep its actions on screen on phones: it used to be
// a fixed 400px cropper with the buttons pushed below the screen edge.
const VIEWPORTS = [
  { name: "phone portrait", width: 390, height: 844 },
  { name: "small phone", width: 360, height: 640 },
  { name: "phone landscape", width: 844, height: 390 },
]

for (const vp of VIEWPORTS) {
  test.describe(`avatar crop on ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true })

    test("save and cancel stay on screen", async ({ page, request }) => {
      await ensureAdmin(request)

      // The mobile layout lands on the room list, not the welcome view.
      await page.goto("/")
      await page.locator("#login").fill(ADMIN_EMAIL)
      await page.locator("#password").fill(TEST_PASSWORD)
      await page.locator('form button[type="submit"]').click()

      await page.locator('.mobile-user-control-panel button[title="Settings"]').click()
      await page.getByRole("button", { name: "Profile" }).click()
      await expect(page.getByTestId("profile-avatar-button")).toBeAttached()

      await page.locator('input[type="file"][accept^="image/png"]').setInputFiles({
        name: "avatar.png",
        mimeType: "image/png",
        buffer: await makePng(page),
      })

      const modal = page.getByTestId("avatar-crop-modal")
      await expect(modal).toBeVisible()
      await expect(page.getByTestId("avatar-crop-save")).toBeEnabled()
      await expect(page.getByTestId("avatar-crop-save")).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId("avatar-crop-cancel")).toBeInViewport({ ratio: 1 })

      // The cropper gets a usable area on every screen.
      const cropper = await modal.locator(".cropper-wrapper").boundingBox()
      expect(cropper?.height ?? 0).toBeGreaterThan(150)

      await page.getByTestId("avatar-crop-cancel").click()
      await expect(modal).toBeHidden()
    })
  })
}
