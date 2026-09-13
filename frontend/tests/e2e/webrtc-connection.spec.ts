import { test, expect } from "@playwright/test"
import {
  assertLiveKitRunning,
  deleteRoom,
  ensureAdmin,
  ensureUser,
  injectSession,
  seedRoom,
} from "./_helpers"

test("two users join a room and establish a LiveKit connection", async ({ browser, request }) => {
  await assertLiveKitRunning(request)

  const admin = await ensureAdmin(request)
  const userA = await ensureUser(request, {
    email: "webrtc-a@orbital-e2e.test",
    nickname: "AliceRTC",
  })
  const userB = await ensureUser(request, {
    email: "webrtc-b@orbital-e2e.test",
    nickname: "BobRTC",
  })

  const room = await seedRoom(request, admin.token, { name: "E2E WebRTC Test Room" })

  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()

  await injectSession(ctxA, userA)
  await injectSession(ctxB, userB)

  // Grant microphone permissions for both contexts
  await ctxA.grantPermissions(["microphone"])
  await ctxB.grantPermissions(["microphone"])

  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  await pageA.goto("/")
  await pageB.goto("/")

  // Join the room
  await pageA.getByTestId(`room-card-${room.id}`).click()
  await pageB.getByTestId(`room-card-${room.id}`).click()

  // Wait for voice call view to load
  await expect(pageA.getByTestId("voice-call-view")).toBeVisible()
  await expect(pageB.getByTestId("voice-call-view")).toBeVisible()

  // Both users should see each other in the presence list
  await expect(pageA.getByTestId(`user-card-${userA.id}`)).toContainText("AliceRTC")
  await expect(pageA.getByTestId(`user-card-${userB.id}`)).toContainText("BobRTC")
  await expect(pageB.getByTestId(`user-card-${userA.id}`)).toContainText("AliceRTC")
  await expect(pageB.getByTestId(`user-card-${userB.id}`)).toContainText("BobRTC")

  // LiveKit connection attempt completes: the connecting overlay disappears
  await expect(pageA.getByText("Connecting to voice server...")).toBeHidden({ timeout: 15000 })
  await expect(pageB.getByText("Connecting to voice server...")).toBeHidden({ timeout: 15000 })

  await ctxA.close()
  await ctxB.close()

  // Clean up the seeded room
  await deleteRoom(request, room.id, admin.token)
})