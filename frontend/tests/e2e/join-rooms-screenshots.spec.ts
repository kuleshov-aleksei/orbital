import { test, expect } from "@playwright/test"
import { setUserIdentity } from "./_helpers"
import { BACKEND_URL, VOICE_ROOMS, loginAll } from "./_screenshotData"

test("join rooms: 5 users join Room A, 2 users join Room B @screenshot", async ({ browser, request }) => {
  // Users created by setup-screenshots.spec.ts
  const { users } = await loginAll(request)
  const userTokens = users.map((u) => ({ id: u.id, nickname: u.nickname, token: u.token }))

  // Get rooms (room lists require auth and are filtered by view_room)
  const authHeaders = { Authorization: `Bearer ${userTokens[0].token}` }
  const roomsRes = await request.get(`${BACKEND_URL}/api/rooms`, { headers: authHeaders })
  const rooms = (await roomsRes.json()) as Array<{ id: string; name: string }>

  const roomA = rooms.find((r) => r.name === VOICE_ROOMS.lateNight.name)
  const roomB = rooms.find((r) => r.name === VOICE_ROOMS.arc.name)

  if (!roomA || !roomB) {
    throw new Error("Rooms not found. Run setup-screenshots.spec.ts first.")
  }

  console.log(`Room A: ${roomA.name} (${roomA.id})`)
  console.log(`Room B: ${roomB.name} (${roomB.id})`)

  // Create 7 browser contexts (one per user)
  const contexts = await Promise.all(userTokens.map((user) => browser.newContext()))

  // Set identity for each context
  for (let i = 0; i < contexts.length; i++) {
    await setUserIdentity(contexts[i], {
      id: userTokens[i].id,
      nickname: userTokens[i].nickname,
      token: userTokens[i].token,
      authProvider: "password",
      isGuest: false,
    })
  }

  // Open pages and navigate
  const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()))

  await Promise.all(pages.map((page) => page.goto("/")))

  // Wait for pages to load
  await Promise.all(pages.map((page) => page.waitForLoadState("networkidle")))

  // Wait for app to initialize
  await Promise.all(pages.map((page) => page.waitForTimeout(2000)))

  // Filter out users who are still on login page
  const validPages: typeof pages = []
  const validUserTokens: typeof userTokens = []

  for (let i = 0; i < pages.length; i++) {
    const isLoginPage = await pages[i]
      .locator('h1:has-text("Welcome")')
      .isVisible()
      .catch(() => false)
    if (!isLoginPage) {
      validPages.push(pages[i])
      validUserTokens.push(userTokens[i])
    } else {
      console.log(`User ${userTokens[i].nickname} failed to authenticate`)
    }
  }

  console.log(`Successfully authenticated ${validPages.length} users`)

  if (validPages.length < 7) {
    throw new Error(`Only ${validPages.length} users authenticated, expected 7`)
  }

  // First 5 users join Room A
  for (let i = 0; i < 5; i++) {
    await validPages[i].getByTestId(`room-card-${roomA.id}`).click()
    await validPages[i].waitForTimeout(500)
  }

  // Last 2 users join Room B
  await validPages[5].getByTestId(`room-card-${roomB.id}`).click()
  await validPages[5].waitForTimeout(500)
  await validPages[6].getByTestId(`room-card-${roomB.id}`).click()
  await validPages[6].waitForTimeout(500)

  // Verify all users are in their rooms
  for (let i = 0; i < 5; i++) {
    await expect(validPages[i].getByTestId("voice-call-view")).toBeVisible({ timeout: 15000 })
    await expect(validPages[i].getByTestId("room-title")).toContainText("Late Night Chill")
  }

  await expect(validPages[5].getByTestId("voice-call-view")).toBeVisible({ timeout: 15000 })
  await expect(validPages[5].getByTestId("room-title")).toContainText("ARC Gaiders")
  await expect(validPages[6].getByTestId("voice-call-view")).toBeVisible({ timeout: 15000 })
  await expect(validPages[6].getByTestId("room-title")).toContainText("ARC Gaiders")

  // Verify user counts
  const roomAUsersRes = await request.get(`${BACKEND_URL}/api/rooms/${roomA.id}/users`, {
    headers: authHeaders,
  })
  const roomAUsers = (await roomAUsersRes.json()) as Array<{ id: string }>
  console.log(`Room A has ${roomAUsers.length} users`)

  const roomBUsersRes = await request.get(`${BACKEND_URL}/api/rooms/${roomB.id}/users`, {
    headers: authHeaders,
  })
  const roomBUsers = (await roomBUsersRes.json()) as Array<{ id: string }>
  console.log(`Room B has ${roomBUsers.length} users`)

  // Cleanup
  await Promise.all(contexts.map((ctx) => ctx.close()))

  console.log("Test completed successfully!")
})
