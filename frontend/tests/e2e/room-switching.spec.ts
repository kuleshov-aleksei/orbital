import { test, expect } from "@playwright/test"

test.describe("room switching bug - switching via sidebar while in call", () => {
  test("user in room B switches to room A via sidebar RoomCard", async ({ browser }) => {
    const ctxA = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    })
    const ctxB = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    })

    await ctxA.grantPermissions(["microphone"])
    await ctxB.grantPermissions(["microphone"])

    const consoleErrorsB: string[] = []
    const allConsoleB: string[] = []

    await ctxA.addInitScript(() => {
      localStorage.setItem("orbital_user_id", "user-a-sidebar")
      localStorage.setItem("orbital_user_nickname", "AliceSidebar")
    })
    await ctxB.addInitScript(() => {
      localStorage.setItem("orbital_user_id", "user-b-sidebar")
      localStorage.setItem("orbital_user_nickname", "BobSidebar")
    })

    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()

    pageB.on("console", (msg) => {
      const text = `[${msg.type()}] ${msg.text()}`
      allConsoleB.push(text)
      if (msg.type() === "error") consoleErrorsB.push(msg.text())
    })

    console.log("\n=== Step 1: User A joins Test room A ===")
    await pageA.goto("/")
    await pageA.getByRole("button", { name: "Continue as Guest" }).click()
    await pageA.waitForSelector("text=Available Rooms", { timeout: 10000 })
    await pageA.locator('[data-testid^="room-card-"]').filter({ hasText: "Test room A" }).click()
    await expect(pageA.getByTestId("voice-call-view")).toBeVisible()
    await pageA.waitForTimeout(3000)

    console.log("\n=== Step 2: User B joins Test room B ===")
    await pageB.goto("/")
    await pageB.getByRole("button", { name: "Continue as Guest" }).click()
    await pageB.waitForSelector("text=Available Rooms", { timeout: 10000 })
    await pageB.locator('[data-testid^="room-card-"]').filter({ hasText: "Test room B" }).click()
    await expect(pageB.getByTestId("voice-call-view")).toBeVisible()
    await pageB.waitForTimeout(3000)

    console.log("\n=== Step 3: User B clicks on Test room A in sidebar (while in Test room B) ===")
    const sidebar = pageB.locator(".room-sidebar")
    await expect(sidebar).toBeVisible()
    
    const roomCardA = sidebar.locator(".room-card").filter({ hasText: "Test room A" })
    await expect(roomCardA).toBeVisible()
    await roomCardA.click()
    
    await expect(pageB.getByTestId("voice-call-view")).toBeVisible()
    await pageB.waitForTimeout(5000)

    console.log("\n=== Step 4: Check audio subscription ===")
    const audioCheck = await pageB.evaluate(() => {
      const audioContainer = document.querySelector(".audio-manager")
      const audioElements = audioContainer ? audioContainer.querySelectorAll("audio") : []
      
      const playingAudios = Array.from(audioElements).filter(
        (el) => (el as HTMLAudioElement).srcObject !== null,
      )

      return {
        playingAudioCount: playingAudios.length,
        hasAudioPlaying: playingAudios.length > 0,
      }
    })
    console.log("Audio check after sidebar room switch:", JSON.stringify(audioCheck, null, 2))

    console.log("\n=== Summary ===")
    console.log("Console errors:", consoleErrorsB)
    console.log("All console messages:", allConsoleB.filter(e => 
      e.includes("peer") || e.includes("Peer") || e.includes("connect") || e.includes("Connect") || e.includes("room") || e.includes("Room") || e.includes("track") || e.includes("Track") || e.includes("audio") || e.includes("Audio") || e.includes("error") || e.includes("Error")
    ))

    expect(audioCheck.playingAudioCount).toBeGreaterThan(0)
    expect(consoleErrorsB.some(e => e.includes("closed peer connection") || e.includes("createOffer"))).toBe(false)

    await ctxA.close()
    await ctxB.close()
  })
})
