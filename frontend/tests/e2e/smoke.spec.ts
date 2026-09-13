import { test, expect } from "@playwright/test"

test("loads welcome screen (empty rooms)", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByTestId("welcome-view")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Available Rooms" })).toBeVisible()
  await expect(page.getByText("No rooms available")).toBeVisible()
})
