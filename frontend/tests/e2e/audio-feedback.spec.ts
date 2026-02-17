import { test, expect } from "@playwright/test"

/**
 * E2E test to detect the feedback loop bug caused by double audio elements.
 * 
 * The bug: When a user connects to a room, LiveKit automatically plays remote
 * audio tracks internally. However, the app also creates custom <audio> elements
 * and plays the same tracks, causing double playback and feedback/echo.
 */

test("detect double audio elements causing feedback loop", async ({
  browser,
}) => {
  // Create two separate browser contexts (simulating different devices)
  const ctxA = await browser.newContext({
    permissions: ["microphone"],
  })
  const ctxB = await browser.newContext({
    permissions: ["microphone"],
  })

  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  // Helper function to count and analyze audio elements
  const countAudioElements = async (page: typeof pageA) => {
    return await page.evaluate(() => {
      const audioElements = document.querySelectorAll("audio")
      const livekitAudioElements = document.querySelectorAll("[data-lk-audio]")
      
      const playingAudioElements = Array.from(audioElements).filter(
        (el) => (el as HTMLAudioElement).srcObject !== null
      )
      
      const audioInfo = Array.from(audioElements).map((el, index) => {
        const audioEl = el as HTMLAudioElement
        const parent = audioEl.parentElement
        return {
          index,
          id: audioEl.id || "no-id",
          srcObject: audioEl.srcObject ? "set" : "null",
          muted: audioEl.muted,
          autoplay: audioEl.autoplay,
          trackCount: audioEl.srcObject instanceof MediaStream 
            ? (audioEl.srcObject as MediaStream).getAudioTracks().length 
            : 0,
          parentTag: parent?.tagName || "unknown",
          parentClasses: parent?.className || "none",
          parentTestId: parent?.getAttribute("data-testid") || "none",
        }
      })
      
      return {
        totalAudioElements: audioElements.length,
        livekitAudioElements: livekitAudioElements.length,
        playingAudioElements: playingAudioElements.length,
        audioInfo,
      }
    })
  }

  // Helper to join room as guest
  const joinAsGuest = async (page: typeof pageA, nickname: string) => {
    await page.goto("http://localhost:3000/")
    
    // Wait for the welcome page to load
    await page.waitForSelector("text=Continue as Guest", { timeout: 10000 })
    
    // Click "Continue as Guest" - this auto-generates a guest nickname
    await page.getByRole("button", { name: "Continue as Guest" }).click()
    
    // Wait for the room list to appear (auto-login happens immediately)
    await page.waitForSelector("text=Available Rooms", { timeout: 10000 })
  }

  // Helper to join an existing room
  const joinRoom = async (page: typeof pageA, roomName: string) => {
    const roomCard = page
      .locator('[data-testid^="room-card-"]')
      .filter({ hasText: roomName })
    await expect(roomCard).toBeVisible()
    await roomCard.click()
    await expect(page.getByTestId("voice-call-view")).toBeVisible()
  }

  // Device A: Login and join existing room
  console.log("Device A: Logging in as guest...")
  await joinAsGuest(pageA, "DeviceA")
  console.log("Device A: Joining room...")
  await joinRoom(pageA, "Testing")

  // Device B: Login and join same room
  console.log("Device B: Logging in as guest...")
  await joinAsGuest(pageB, "DeviceB")
  console.log("Device B: Joining room...")
  await joinRoom(pageB, "Testing")

  // Wait for LiveKit to establish connection and subscribe to tracks
  console.log("Waiting for LiveKit connection...")
  await pageA.waitForTimeout(5000)
  await pageB.waitForTimeout(5000)

  // Check audio elements on Device A
  console.log("\n=== Checking audio elements ===")
  const audioStatsA = await countAudioElements(pageA)
  console.log("\nDevice A audio elements:", JSON.stringify(audioStatsA, null, 2))

  // Check audio elements on Device B  
  const audioStatsB = await countAudioElements(pageB)
  console.log("\nDevice B audio elements:", JSON.stringify(audioStatsB, null, 2))

  // Analysis
  console.log("\n=== FEEDBACK LOOP ANALYSIS ===")
  console.log(`Device A: ${audioStatsA.totalAudioElements} total audio elements, ${audioStatsA.playingAudioElements} playing`)
  console.log(`Device B: ${audioStatsB.totalAudioElements} total audio elements, ${audioStatsB.playingAudioElements} playing`)
  
  const checkForDuplicates = (stats: typeof audioStatsA, deviceName: string) => {
    const audioWithStreams = stats.audioInfo.filter(a => a.srcObject === "set")
    
    if (audioWithStreams.length > 1) {
      console.log(`\n⚠️  WARNING: ${deviceName} has ${audioWithStreams.length} playing audio elements!`)
      console.log("This indicates the feedback loop bug where audio is played twice.")
      
      audioWithStreams.forEach((info, idx) => {
        console.log(`  Audio ${idx + 1}: id=${info.id}, parent=${info.parentTag}.${info.parentClasses}, tracks=${info.trackCount}`)
      })
      
      return true
    }
    return false
  }
  
  const hasDuplicatesA = checkForDuplicates(audioStatsA, "Device A")
  const hasDuplicatesB = checkForDuplicates(audioStatsB, "Device B")
  
  if (hasDuplicatesA || hasDuplicatesB) {
    console.log("\n🐛 BUG DETECTED: Multiple audio elements playing simultaneously!")
    console.log("This confirms the feedback loop issue where audio is amplified.")
  } else {
    console.log("\n✅ OK: No duplicate playing audio elements detected.")
  }

  // Take screenshots for debugging
  await pageA.screenshot({
    path: "test-results/device-a-audio-check.png",
    fullPage: true,
  })
  await pageB.screenshot({
    path: "test-results/device-b-audio-check.png",
    fullPage: true,
  })

  // Assertions - each device should have at most 1 playing audio element per remote participant
  expect(audioStatsA.playingAudioElements).toBeLessThanOrEqual(1)
  expect(audioStatsB.playingAudioElements).toBeLessThanOrEqual(1)

  await ctxA.close()
  await ctxB.close()
})

test("analyze ParticipantCard audio element structure", async ({ browser }) => {
  const ctx = await browser.newContext({
    permissions: ["microphone"],
  })
  const page = await ctx.newPage()

  // Login as guest
  await page.goto("http://localhost:3000/")
  await page.getByRole("button", { name: "Continue as Guest" }).click()
  // Wait for auto-login and room list to appear
  await page.waitForSelector("text=Available Rooms", { timeout: 10000 })

  // Join existing "Testing" room
  const roomCard = page
    .locator('[data-testid^="room-card-"]')
    .filter({ hasText: "Testing" })
  await roomCard.click()
  await expect(page.getByTestId("voice-call-view")).toBeVisible()

  // Wait for connection
  await page.waitForTimeout(3000)

  // Analyze ParticipantCard audio elements
  const participantCardAudio = await page.evaluate(() => {
    const cards = document.querySelectorAll(".participant-card")
    const results: Array<{
      cardIndex: number
      userId: string
      audioElements: number
      audioDetails: Array<{
        id: string
        srcObject: string
        muted: boolean
        autoplay: boolean
        hasStream: boolean
        parentTag: string
        parentClasses: string
      }>
    }> = []
    
    cards.forEach((card, index) => {
      const audios = card.querySelectorAll("audio")
      const userId = card.getAttribute("data-user-id") || `card-${index}`
      
      results.push({
        cardIndex: index,
        userId,
        audioElements: audios.length,
        audioDetails: Array.from(audios).map(a => {
          const audioEl = a as HTMLAudioElement
          return {
            id: audioEl.id,
            srcObject: audioEl.srcObject ? "set" : "null",
            muted: audioEl.muted,
            autoplay: audioEl.autoplay,
            hasStream: audioEl.srcObject instanceof MediaStream,
            parentTag: audioEl.parentElement?.tagName || "unknown",
            parentClasses: audioEl.parentElement?.className || "none",
          }
        }),
      })
    })
    
    return results
  })

  console.log("\n=== ParticipantCard Audio Element Analysis ===")
  console.log(JSON.stringify(participantCardAudio, null, 2))

  // Log findings
  participantCardAudio.forEach((card) => {
    console.log(`\nCard ${card.cardIndex} (user: ${card.userId}):`)
    console.log(`  Audio elements: ${card.audioElements}`)
    
    card.audioDetails.forEach((audio, idx) => {
      console.log(`  Audio ${idx + 1}:`)
      console.log(`    - id: ${audio.id}`)
      console.log(`    - srcObject: ${audio.srcObject}`)
      console.log(`    - muted: ${audio.muted}`)
      console.log(`    - autoplay: ${audio.autoplay}`)
      console.log(`    - hasStream: ${audio.hasStream}`)
      console.log(`    - parent: ${audio.parentTag}.${audio.parentClasses}`)
    })
  })

  // Verify: Each card should have at most 1 audio element
  participantCardAudio.forEach((card) => {
    expect(card.audioElements).toBeLessThanOrEqual(1)
  })

  await ctx.close()
})
