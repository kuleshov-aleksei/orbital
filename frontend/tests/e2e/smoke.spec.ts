import { test, expect } from "@playwright/test"
import { resetBackend } from "./_helpers"

test("loads welcome screen (empty rooms)", async ({ page, request }) => {
  await resetBackend(request)

  await page.goto("/")

  await expect(page.getByTestId("welcome-view")).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Available Rooms" }),
  ).toBeVisible()
  await expect(page.getByText("No rooms available")).toBeVisible()
})
