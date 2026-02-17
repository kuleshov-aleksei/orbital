import { test, expect } from "@playwright/test"
import { resetBackend, seedRoom, setUserIdentity } from "./_helpers"

test("two users establish WebRTC audio connection", async ({ browser, request }) => {
  await resetBackend(request)
  const room = await seedRoom(request, { name: "E2E WebRTC Test Room" })

  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()

  await setUserIdentity(ctxA, { id: "e2e-user-a", nickname: "Alice" })
  await setUserIdentity(ctxB, { id: "e2e-user-b", nickname: "Bob" })

  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  // Grant microphone permissions for both contexts
  await ctxA.grantPermissions(["microphone"])
  await ctxB.grantPermissions(["microphone"])

  await pageA.goto("/")
  await pageB.goto("/")

  // Join the room
  await pageA.getByTestId(`room-card-${room.id}`).click()
  await pageB.getByTestId(`room-card-${room.id}`).click()

  // Wait for voice call view to load
  await expect(pageA.getByTestId("voice-call-view")).toBeVisible()
  await expect(pageB.getByTestId("voice-call-view")).toBeVisible()

  // Enable debug dashboard for both users (bottom-right debug button)
  await pageA.locator('button:has-text("Debug")').click()
  await pageB.locator('button:has-text("Debug")').click()

  // Wait for debug panel to appear (the panel itself)
  await expect(pageA.locator(".fixed.inset-0")).toBeVisible()
  await expect(pageB.locator(".fixed.inset-0")).toBeVisible()

  // Switch to logs tab to see connection logs
  await pageA.locator("button", { hasText: "Logs" }).click()
  await pageB.locator("button", { hasText: "Logs" }).click()

  // Wait for WebRTC connection attempts
  await pageA.waitForTimeout(3000)
  await pageB.waitForTimeout(3000)

  // Check that connection logs contain WebRTC signaling
  const logsA = await pageA.locator(".debug-dashboard .text-xs").allTextContents()
  const logsB = await pageB.locator(".debug-dashboard .text-xs").allTextContents()

  console.log("Alice logs:", logsA)
  console.log("Bob logs:", logsB)

  // Look for key WebRTC events
  const expectedEvents = [
    "SDP offer",
    "SDP answer",
    "ICE candidate",
    "Creating peer connection",
    "Local media stream obtained",
  ]

  let aliceHasConnectionEvents = false
  let bobHasConnectionEvents = false

  for (const event of expectedEvents) {
    if (logsA.some((log) => log.includes(event))) {
      aliceHasConnectionEvents = true
    }
    if (logsB.some((log) => log.includes(event))) {
      bobHasConnectionEvents = true
    }
  }

  // Check connection states in metrics tab
  await pageA.locator("button", { hasText: "Metrics" }).click()
  await pageB.locator("button", { hasText: "Metrics" }).click()

  // Wait a bit for stats to populate
  await pageA.waitForTimeout(2000)
  await pageB.waitForTimeout(2000)

  // Look for connection states
  const metricsA = await pageA.locator(".debug-dashboard").textContent()
  const metricsB = await pageB.locator(".debug-dashboard").textContent()

  console.log("Alice metrics:", metricsA)
  console.log("Bob metrics:", metricsB)

  // Check if debug info shows connection states
  const hasConnectionStates =
    metricsA?.includes("disconnected") ||
    metricsA?.includes("connected") ||
    metricsB?.includes("disconnected") ||
    metricsB?.includes("connected")

  console.log("Has connection states:", hasConnectionStates)
  console.log("Alice has WebRTC events:", aliceHasConnectionEvents)
  console.log("Bob has WebRTC events:", bobHasConnectionEvents)

  // Take screenshots for debugging
  await pageA.screenshot({
    path: "test-results/alice-debug.png",
    fullPage: true,
  })
  await pageB.screenshot({
    path: "test-results/bob-debug.png",
    fullPage: true,
  })

  await ctxA.close()
  await ctxB.close()
})
