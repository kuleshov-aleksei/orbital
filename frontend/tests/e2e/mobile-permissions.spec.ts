import { test, expect } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"
import {
  ADMIN_EMAIL,
  TEST_PASSWORD,
  deleteRoom,
  ensureAdmin,
  ensureUser,
  seedRoom,
} from "./_helpers"

const BACKEND_URL = "http://127.0.0.1:8080"

// Touch long press: useLongPress fires after 450 ms of a still finger.
async function longPress(target: Locator) {
  const box = await target.boundingBox()
  if (!box) throw new Error("long press target is not visible")
  const init = {
    pointerType: "touch",
    button: 0,
    isPrimary: true,
    bubbles: true,
    clientX: box.x + box.width / 2,
    clientY: box.y + Math.min(box.height / 2, 14),
  }
  await target.dispatchEvent("pointerdown", init)
  await target.page().waitForTimeout(600)
  await target.dispatchEvent("pointerup", init)
}

async function loginMobile(page: Page, login: string) {
  // The mobile layout lands on the room list.
  await page.goto("/")
  await page.locator("#login").fill(login)
  await page.locator("#password").fill(TEST_PASSWORD)
  await page.locator('form button[type="submit"]').click()
}

test.describe("channel permissions on mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test("long press on a room edits its permissions", async ({ page, request }) => {
    const admin = await ensureAdmin(request)
    const room = await seedRoom(request, admin.token, { name: "Mobile Perms Room" })

    try {
      await loginMobile(page, ADMIN_EMAIL)
      const card = page.getByTestId(`sidebar-room-${room.id}`)
      await expect(card).toBeVisible()

      await longPress(card)
      const sheet = page.getByTestId("room-action-sheet")
      await expect(sheet).toBeVisible()
      // The desktop popover must not open on top of the sheet.
      await expect(page.getByTestId("context-room-permissions")).toHaveCount(0)

      await sheet.getByTestId("sheet-room-permissions").click()
      await expect(sheet).toBeHidden()
      const modal = page.getByTestId("permissions-modal")
      await expect(modal).toBeVisible()

      // @everyone is selected first: deny Video for this room and save.
      await modal.getByTestId("perm-Video-deny").click()
      await expect(page.getByTestId("permissions-save")).toBeInViewport({ ratio: 1 })
      await page.getByTestId("permissions-save").click()
      await expect(modal.getByTestId("perm-Video-deny")).toHaveAttribute("aria-checked", "true")

      const res = await request.get(`${BACKEND_URL}/api/rooms/${room.id}/overwrites`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      })
      expect(res.ok()).toBeTruthy()
      const overwrites = (await res.json()) as Array<{ subject_id: string; deny: number }>
      expect(overwrites.some((o) => o.subject_id === "everyone" && o.deny !== 0)).toBeTruthy()

      await page.getByTestId("permissions-close").click()
      await expect(modal).toBeHidden()
    } finally {
      await deleteRoom(request, room.id, admin.token)
    }
  })

  test("members without manage_roles get no Permissions row", async ({ page, request }) => {
    const admin = await ensureAdmin(request)
    await ensureUser(request, {
      email: "mobile-perms-member@orbital-e2e.test",
      nickname: "MobilePermsMember",
    })
    const room = await seedRoom(request, admin.token, { name: "Mobile Perms Member Room" })

    try {
      await loginMobile(page, "mobile-perms-member@orbital-e2e.test")
      const card = page.getByTestId(`sidebar-room-${room.id}`)
      await expect(card).toBeVisible()

      await longPress(card)
      const sheet = page.getByTestId("room-action-sheet")
      await expect(sheet).toBeVisible()
      await expect(sheet.getByTestId("sheet-room-permissions")).toHaveCount(0)
    } finally {
      await deleteRoom(request, room.id, admin.token)
    }
  })
})
