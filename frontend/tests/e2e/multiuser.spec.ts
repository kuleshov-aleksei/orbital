import { test, expect } from "@playwright/test"
import { deleteRoom, ensureAdmin, ensureUser, injectSession, seedRoom } from "./_helpers"

test("two users join same room and see each other", async ({ browser, request }) => {
  const admin = await ensureAdmin(request)
  const alice = await ensureUser(request, { email: "alice@orbital-e2e.test", nickname: "Alice" })
  const bob = await ensureUser(request, { email: "bob@orbital-e2e.test", nickname: "Bob" })

  const room = await seedRoom(request, admin.token, { name: "E2E Multiuser Room" })

  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()

  await injectSession(ctxA, alice)
  await injectSession(ctxB, bob)

  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  await pageA.goto("/")
  await pageB.goto("/")

  await pageA.getByTestId(`room-card-${room.id}`).click()
  await pageB.getByTestId(`room-card-${room.id}`).click()

  await expect(pageA.getByTestId("user-sidebar")).toBeVisible()
  await expect(pageB.getByTestId("user-sidebar")).toBeVisible()

  // `user-list` is a single container element; assert on individual user cards to avoid
  // array semantics of toContainText() (which expects multiple matched elements).
  await expect(pageA.getByTestId(`user-card-${alice.id}`)).toContainText("Alice")
  await expect(pageA.getByTestId(`user-card-${bob.id}`)).toContainText("Bob")
  await expect(pageB.getByTestId(`user-card-${alice.id}`)).toContainText("Alice")
  await expect(pageB.getByTestId(`user-card-${bob.id}`)).toContainText("Bob")

  await ctxA.close()
  await ctxB.close()

  // Clean up the seeded room
  await deleteRoom(request, room.id, admin.token)
})