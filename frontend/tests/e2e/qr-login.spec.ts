import { expect, test } from "@playwright/test"
import { ensureUser, loginViaUi, TEST_PASSWORD } from "./_helpers"

const BACKEND_URL = "http://127.0.0.1:8080"

test.describe("QR device linking", () => {
  test("new device shows a dots QR code and signs in after approval", async ({
    page,
    request,
  }) => {
    // New device: open the QR tab and wait for the generated code.
    await page.goto("/")
    const createPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/auth/qr/challenge") && res.request().method() === "POST",
    )
    await page.getByTestId("auth-tab-qr").click()
    const createResponse = await createPromise
    expect(createResponse.ok()).toBe(true)
    const created = (await createResponse.json()) as { challenge_id: string }
    expect(created.challenge_id.length).toBeGreaterThan(10)

    const code = page.getByTestId("qr-login-code")
    await expect(code).toBeVisible()
    // Dots profile: data modules as circles, finder eyes as rounded rects.
    const svg = await code.innerHTML()
    expect(svg).toContain("<circle")
    // The SVG must actually paint at a usable size, not collapse to a blank box.
    const box = await code.locator("svg").boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(150)
    expect(box?.height ?? 0).toBeGreaterThan(150)
    await expect(page.getByText(/Code expires in/)).toBeVisible()

    // Regeneration is gated: a fresh code (2 min TTL) cannot be replaced until
    // its final 30 seconds, so the button stays disabled and a hint is shown.
    const regen = page.getByRole("button", { name: "Generate a new code" })
    await expect(regen).toBeDisabled()
    await expect(page.getByText(/You can generate a new code in/)).toBeVisible()

    // Existing device approves over the API (headless cameras cannot scan;
    // the scanning UI itself is covered by the Security-tab test below).
    const approver = await ensureUser(request, {
      email: "qr-approver@orbital-e2e.test",
      nickname: "QRApprover",
    })
    const viewRes = await request.get(
      `${BACKEND_URL}/api/auth/qr/challenge/${created.challenge_id}`,
      { headers: { Authorization: `Bearer ${approver.token}` } },
    )
    expect(viewRes.ok()).toBe(true)
    const view = (await viewRes.json()) as {
      public_key: string
      device_name: string
      status: string
    }
    expect(view.status).toBe("pending")

    const approveRes = await request.post(`${BACKEND_URL}/api/auth/qr/approve`, {
      headers: { Authorization: `Bearer ${approver.token}` },
      data: { challenge_id: created.challenge_id, public_key: view.public_key },
    })
    expect(approveRes.ok()).toBe(true)

    // The waiting panel polls, opens the sealed box, and signs in as the
    // approver without any further interaction.
    await expect(page.getByTestId("auth-tab-qr")).toHaveCount(0, { timeout: 15000 })
    await expect(page.getByText("QRApprover").first()).toBeVisible({ timeout: 15000 })
  })

  test("Security tab offers QR scanning to logged-in users", async ({ page, request }) => {
    const user = await ensureUser(request, {
      email: "qr-scanner@orbital-e2e.test",
      nickname: "QRScanner",
    })
    await loginViaUi(page, user.email, TEST_PASSWORD)

    await page.getByTitle("Settings").click()
    await page.getByText("Security", { exact: true }).click()
    const scanButton = page.getByRole("button", { name: "Scan QR code" })
    await expect(scanButton).toBeVisible()
    await scanButton.click()

    // The scanner modal opens; the camera phase depends on the environment,
    // but the dialog itself must render without crashing.
    await expect(page.getByRole("heading", { name: "Link a new device" })).toBeVisible()
  })
})
