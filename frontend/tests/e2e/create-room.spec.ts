import { test, expect } from "@playwright/test"
import { resetBackend } from "./_helpers"

test("create room via UI and leave", async ({ page, request }) => {
  await resetBackend(request)

  await page.goto("/")

  // Open create room modal
  await page.getByTestId("create-room-welcome").click()
  await expect(page.getByTestId("room-modal")).toBeVisible()

  // Fill in room details and create
  await page.getByTestId("room-name-input").fill("E2E Room")
  await page.getByTestId("room-create-submit").click()

  // Wait for modal to close and room to appear in the list
  await expect(page.getByTestId("room-modal")).not.toBeVisible()

  // Find and click the room card by the room name text (room ID is dynamic)
  const roomCard = page.locator('[data-testid^="room-card-"]').filter({ hasText: "E2E Room" })
  await expect(roomCard).toBeVisible()
  await roomCard.click()

  // Verify we're in the voice call view
  await expect(page.getByTestId("voice-call-view")).toBeVisible()
  await expect(page.getByTestId("room-title")).toHaveText("E2E Room")

  // Leave the room
  await page.getByTestId("leave-room-header").click()
  await expect(page.getByTestId("welcome-view")).toBeVisible()
})
