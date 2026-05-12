import { test, expect } from "@playwright/test"
import { setUserIdentity, guestLogin } from "./_helpers"

const NICKNAMES = [
  "RNGESUS",
  "Flex Tape",
  "Chunky Cheese",
  "Muffin",
  "Garfield",
  "Quota, Son of Company",
  "Zavala's Hair",
]

test("join rooms: 5 users join Room A, 2 users join Room B", async ({ browser, request }) => {
  // Get existing users from the backend
  const usersRes = await request.get("http://127.0.0.1:8080/api/users")
  const users = (await usersRes.json()) as Array<{ id: string; nickname: string }>

  // Find our test users
  const testUsers = users.filter((u) => NICKNAMES.includes(u.nickname))

  if (testUsers.length < 7) {
    throw new Error(
      `Expected 7 test users, found ${testUsers.length}. Run setup-screenshots.spec.ts first.`,
    )
  }

  // Get rooms
  const roomsRes = await request.get("http://127.0.0.1:8080/api/rooms")
  const rooms = (await roomsRes.json()) as Array<{ id: string; name: string }>

  const roomA = rooms.find((r) => r.name === "🌠 Late Night Chill")
  const roomB = rooms.find((r) => r.name === "⛏️ ARC Gaiders")

  if (!roomA || !roomB) {
    throw new Error("Rooms not found. Run setup-screenshots.spec.ts first.")
  }

  console.log(`Room A: ${roomA.name} (${roomA.id})`)
  console.log(`Room B: ${roomB.name} (${roomB.id})`)

  // Login as each user and get tokens
  const userTokens: { id: string; nickname: string; token: string }[] = []

  for (const nickname of NICKNAMES) {
    const loginRes = await request.post("http://127.0.0.1:8080/api/auth/login", {
      data: { login: nickname, password: "P@ssword123" },
    })

    if (!loginRes.ok()) {
      throw new Error(`Failed to login as ${nickname}`)
    }

    const loginData = (await loginRes.json()) as { token: string; user: { id: string } }
    userTokens.push({
      id: loginData.user.id,
      nickname,
      token: loginData.token,
    })
  }

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
  for (let i = 0; i < 4; i++) {
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
    await expect(validPages[i].getByTestId("room-title")).toHaveText("Valorant Squad")
  }

  await expect(validPages[5].getByTestId("voice-call-view")).toBeVisible({ timeout: 15000 })
  await expect(validPages[5].getByTestId("room-title")).toHaveText("League Lounge")
  await expect(validPages[6].getByTestId("voice-call-view")).toBeVisible({ timeout: 15000 })
  await expect(validPages[6].getByTestId("room-title")).toHaveText("League Lounge")

  // Verify user counts
  const roomAUsersRes = await request.get(`http://127.0.0.1:8080/api/rooms/${roomA.id}/users`)
  const roomAUsers = (await roomAUsersRes.json()) as Array<{ id: string }>
  console.log(`Room A has ${roomAUsers.length} users`)

  const roomBUsersRes = await request.get(`http://127.0.0.1:8080/api/rooms/${roomB.id}/users`)
  const roomBUsers = (await roomBUsersRes.json()) as Array<{ id: string }>
  console.log(`Room B has ${roomBUsers.length} users`)

  // Cleanup
  await Promise.all(contexts.map((ctx) => ctx.close()))

  console.log("Test completed successfully!")
})
