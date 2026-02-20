import { test, expect } from "@playwright/test"

/**
 * E2E test to detect the feedback loop bug caused by double audio elements.
 *
 * The bug: When a user connects to a room, LiveKit automatically plays remote
 * audio tracks internally. However, the app also creates custom <audio> elements
 * and plays the same tracks, causing double playback and feedback/echo.
 */

test("detect double audio elements causing feedback loop", async ({ browser }) => {
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
        (el) => (el as HTMLAudioElement).srcObject !== null,
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
          trackCount:
            audioEl.srcObject instanceof MediaStream
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
    const roomCard = page.locator('[data-testid^="room-card-"]').filter({ hasText: roomName })
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
  console.log(
    `Device A: ${audioStatsA.totalAudioElements} total audio elements, ${audioStatsA.playingAudioElements} playing`,
  )
  console.log(
    `Device B: ${audioStatsB.totalAudioElements} total audio elements, ${audioStatsB.playingAudioElements} playing`,
  )

  const checkForDuplicates = (stats: typeof audioStatsA, deviceName: string) => {
    const audioWithStreams = stats.audioInfo.filter((a) => a.srcObject === "set")

    if (audioWithStreams.length > 1) {
      console.log(
        `\n⚠️  WARNING: ${deviceName} has ${audioWithStreams.length} playing audio elements!`,
      )
      console.log("This indicates the feedback loop bug where audio is played twice.")

      audioWithStreams.forEach((info, idx) => {
        console.log(
          `  Audio ${idx + 1}: id=${info.id}, parent=${info.parentTag}.${info.parentClasses}, tracks=${info.trackCount}`,
        )
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
  const roomCard = page.locator('[data-testid^="room-card-"]').filter({ hasText: "Testing" })
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
        audioDetails: Array.from(audios).map((a) => {
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

test("check for duplicate PLAYING audio per user", async ({ browser }) => {
  const ctx = await browser.newContext({
    permissions: ["microphone"],
  })
  const page = await ctx.newPage()

  await page.goto("http://localhost:3000/")
  await page.getByRole("button", { name: "Continue as Guest" }).click()
  await page.waitForSelector("text=Available Rooms", { timeout: 10000 })

  const roomCard = page.locator('[data-testid^="room-card-"]').filter({ hasText: "Testing" })
  await roomCard.click()
  await expect(page.getByTestId("voice-call-view")).toBeVisible()

  // Wait for connection
  await page.waitForTimeout(3000)

  // Check for duplicate PLAYING audio elements (srcObject is set)
  const playingAudioAnalysis = await page.evaluate(() => {
    const playingAudios = Array.from(document.querySelectorAll("audio")).filter(
      (el) => (el as HTMLAudioElement).srcObject !== null,
    )

    const userIdCount: Record<string, number> = {}
    const userIdDetails: Record<string, Array<{ component: string; parentClasses: string }>> = {}

    playingAudios.forEach((audio) => {
      const audioEl = audio as HTMLAudioElement
      const userId = audioEl.id?.replace("audio-", "") || "unknown"
      let parent = audioEl.parentElement
      let componentName = "unknown"

      // Walk up the DOM to find which component contains this audio
      while (parent) {
        const classes = parent.className || ""
        if (classes.includes("screen-share-area")) {
          componentName = "ScreenShareArea"
          break
        } else if (classes.includes("grid") && classes.includes("gap-4")) {
          componentName = "UserGrid"
          break
        }
        parent = parent.parentElement
      }

      userIdCount[userId] = (userIdCount[userId] || 0) + 1
      if (!userIdDetails[userId]) {
        userIdDetails[userId] = []
      }
      userIdDetails[userId].push({
        component: componentName,
        parentClasses: parent?.className?.slice(0, 50) || "none",
      })
    })

    return { userIdCount, userIdDetails, totalPlaying: playingAudios.length }
  })

  console.log("\n=== PLAYING AUDIO ANALYSIS ===")
  console.log(`Total playing audio elements: ${playingAudioAnalysis.totalPlaying}`)
  console.log("User ID counts:", JSON.stringify(playingAudioAnalysis.userIdCount, null, 2))

  // Check for duplicates (a user should appear at most once with playing audio)
  const duplicates = Object.entries(playingAudioAnalysis.userIdCount).filter(
    ([_, count]) => count > 1,
  )
  if (duplicates.length > 0) {
    console.log("\n🐛 DUPLICATE PLAYING AUDIO FOUND:")
    duplicates.forEach(([userId, count]) => {
      console.log(`  User ${userId}: has ${count} playing audio elements!`)
      console.log(
        `    Details:`,
        JSON.stringify(playingAudioAnalysis.userIdDetails[userId], null, 2),
      )
    })
  } else {
    console.log("\n✅ No duplicate playing audio - feedback loop is prevented!")
  }

  // Expect no duplicate playing audio (each user should have at most 1 playing audio)
  duplicates.forEach(([userId, count]) => {
    expect(count).toBe(1)
  })

  await ctx.close()
})

test("debug: analyze which components have playing audio", async ({ browser }) => {
  const ctx = await browser.newContext({
    permissions: ["microphone"],
  })
  const page = await ctx.newPage()

  await page.goto("http://localhost:3000/")
  await page.getByRole("button", { name: "Continue as Guest" }).click()
  await page.waitForSelector("text=Available Rooms", { timeout: 10000 })

  const roomCard = page.locator('[data-testid^="room-card-"]').filter({ hasText: "Testing" })
  await roomCard.click()
  await expect(page.getByTestId("voice-call-view")).toBeVisible()

  // Wait for connection
  await page.waitForTimeout(3000)

  // Detailed analysis of where playing audio elements are
  const audioAnalysis = await page.evaluate(() => {
    const playingAudios = Array.from(document.querySelectorAll("audio")).filter(
      (el) => (el as HTMLAudioElement).srcObject !== null,
    )

    return playingAudios.map((audio, index) => {
      const audioEl = audio as HTMLAudioElement
      let parent = audioEl.parentElement
      let componentName = "unknown"
      let hierarchy: string[] = []

      // Walk up the DOM to find which component contains this audio
      while (parent) {
        const classes = parent.className || ""
        hierarchy.push(`${parent.tagName}.${classes.slice(0, 50)}`)

        if (classes.includes("screen-share-area")) {
          componentName = "ScreenShareArea"
          break
        } else if (parent.className?.includes("grid") && parent.className?.includes("gap-4")) {
          componentName = "UserGrid"
          break
        }
        parent = parent.parentElement
      }

      return {
        index,
        id: audioEl.id,
        component: componentName,
        parentHierarchy: hierarchy.slice(0, 3),
      }
    })
  })

  console.log("\n=== PLAYING AUDIO ELEMENTS ANALYSIS ===")
  console.log(JSON.stringify(audioAnalysis, null, 2))

  // Also analyze ALL audio elements (not just playing) to understand the structure
  const allAudioAnalysis = await page.evaluate(() => {
    const allAudios = Array.from(document.querySelectorAll("audio"))

    return allAudios.map((audio, index) => {
      const audioEl = audio as HTMLAudioElement
      let parent = audioEl.parentElement
      let componentName = "unknown"
      let parentIsVisible = false

      // Walk up the DOM to find which component contains this audio
      while (parent) {
        const classes = parent.className || ""
        const style = window.getComputedStyle(parent)

        if (classes.includes("screen-share-area")) {
          componentName = "ScreenShareArea"
          parentIsVisible = style.display !== "none"
          break
        } else if (parent.className?.includes("grid") && parent.className?.includes("gap-4")) {
          componentName = "UserGrid"
          parentIsVisible = style.display !== "none"
          break
        }
        parent = parent.parentElement
      }

      return {
        index,
        id: audioEl.id,
        srcObject: audioEl.srcObject ? "set" : "null",
        component: componentName,
        parentIsVisible,
      }
    })
  })

  console.log("\n=== ALL AUDIO ELEMENTS ANALYSIS ===")
  console.log(JSON.stringify(allAudioAnalysis, null, 2))

  await ctx.close()
})

test("detect LiveKit internal audio elements", async ({ browser }) => {
  const ctxA = await browser.newContext({ permissions: ["microphone"] })
  const ctxB = await browser.newContext({ permissions: ["microphone"] })
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  // Join room
  await pageA.goto("http://localhost:3000/")
  await pageA.getByRole("button", { name: "Continue as Guest" }).click()
  await pageA.waitForSelector("text=Available Rooms", { timeout: 10000 })
  await pageA.locator('[data-testid^="room-card-"]').filter({ hasText: "Testing" }).click()
  await expect(pageA.getByTestId("voice-call-view")).toBeVisible()

  await pageB.goto("http://localhost:3000/")
  await pageB.getByRole("button", { name: "Continue as Guest" }).click()
  await pageB.waitForSelector("text=Available Rooms", { timeout: 10000 })
  await pageB.locator('[data-testid^="room-card-"]').filter({ hasText: "Testing" }).click()
  await expect(pageB.getByTestId("voice-call-view")).toBeVisible()

  await pageA.waitForTimeout(5000)
  await pageB.waitForTimeout(5000)

  // Check for ALL audio sources including LiveKit internal
  const checkAllAudioSources = async (page: typeof pageA, deviceName: string) => {
    const result = await page.evaluate(() => {
      // 1. Our custom audio elements
      const customAudios = Array.from(document.querySelectorAll("audio"))
      const customPlaying = customAudios.filter((el) => (el as HTMLAudioElement).srcObject !== null)

      // 2. LiveKit internal audio elements (data-lk-audio)
      const livekitAudios = Array.from(document.querySelectorAll("[data-lk-audio]"))

      // 3. All elements with 'audio' in their role or tag
      const allMediaElements = Array.from(document.querySelectorAll("audio, video"))

      // 4. Check WebRTC connections
      const peerConnections = (window as { RTCPeerConnection?: typeof RTCPeerConnection })
        .RTCPeerConnection
      const pcCount = peerConnections ? 1 : 0 // Just checking if API exists

      return {
        customAudioCount: customAudios.length,
        customPlayingCount: customPlaying.length,
        livekitAudioCount: livekitAudios.length,
        allMediaCount: allMediaElements.length,
        customAudioIds: customAudios.map((el) => (el as HTMLAudioElement).id || "no-id"),
        customAudioDetails: customAudios.map((el) => {
          const audioEl = el as HTMLAudioElement
          return {
            id: audioEl.id,
            srcObject: audioEl.srcObject ? "set" : "null",
            muted: audioEl.muted,
            volume: audioEl.volume,
            paused: audioEl.paused,
            parentClasses: audioEl.parentElement?.className?.slice(0, 50),
          }
        }),
      }
    })

    console.log(`\n=== ${deviceName} Audio Sources ===`)
    console.log(
      `Custom audio elements: ${result.customAudioCount} (${result.customPlayingCount} playing)`,
    )
    console.log(`LiveKit internal audio elements: ${result.livekitAudioCount}`)
    console.log(`All media elements: ${result.allMediaCount}`)
    console.log("Custom audio details:", JSON.stringify(result.customAudioDetails, null, 2))

    return result
  }

  const audioA = await checkAllAudioSources(pageA, "Device A")
  const audioB = await checkAllAudioSources(pageB, "Device B")

  // Check if there are duplicate IDs (same user appearing multiple times)
  const checkDuplicates = (audioDetails: typeof audioA.customAudioDetails, deviceName: string) => {
    const ids = audioDetails.filter((a) => a.srcObject === "set").map((a) => a.id)
    const uniqueIds = new Set(ids)
    if (ids.length !== uniqueIds.size) {
      console.log(`\n🐛 ${deviceName}: Duplicate playing audio IDs found!`)
      console.log(`  Total playing: ${ids.length}, Unique: ${uniqueIds.size}`)
      console.log(`  IDs: ${ids.join(", ")}`)
      return true
    }
    return false
  }

  const hasDuplicatesA = checkDuplicates(audioA.customAudioDetails, "Device A")
  const hasDuplicatesB = checkDuplicates(audioB.customAudioDetails, "Device B")

  expect(hasDuplicatesA).toBe(false)
  expect(hasDuplicatesB).toBe(false)

  await ctxA.close()
  await ctxB.close()
})

test("reconnection scenario - leave and rejoin", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["microphone"] })
  const page = await ctx.newPage()

  const joinRoom = async () => {
    await page.goto("http://localhost:3000/")
    await page.getByRole("button", { name: "Continue as Guest" }).click()
    await page.waitForSelector("text=Available Rooms", { timeout: 10000 })
    await page.locator('[data-testid^="room-card-"]').filter({ hasText: "Testing" }).click()
    await expect(page.getByTestId("voice-call-view")).toBeVisible()
    await page.waitForTimeout(3000)
  }

  const countPlayingAudio = async () => {
    return await page.evaluate(() => {
      return Array.from(document.querySelectorAll("audio")).filter(
        (el) => (el as HTMLAudioElement).srcObject !== null,
      ).length
    })
  }

  // First connection
  console.log("\n=== First connection ===")
  await joinRoom()
  const count1 = await countPlayingAudio()
  console.log(`Playing audio elements: ${count1}`)

  // Leave room (go back to room list)
  console.log("\n=== Leaving room ===")
  await page
    .getByRole("button", { name: /leave|back/i })
    .first()
    .click()
  await page.waitForSelector("text=Available Rooms", { timeout: 10000 })
  await page.waitForTimeout(1000)

  // Rejoin
  console.log("\n=== Rejoining room ===")
  await page.locator('[data-testid^="room-card-"]').filter({ hasText: "Testing" }).click()
  await expect(page.getByTestId("voice-call-view")).toBeVisible()
  await page.waitForTimeout(3000)
  const count2 = await countPlayingAudio()
  console.log(`Playing audio elements: ${count2}`)

  // Leave and rejoin again
  console.log("\n=== Leaving and rejoining again ===")
  await page
    .getByRole("button", { name: /leave|back/i })
    .first()
    .click()
  await page.waitForSelector("text=Available Rooms", { timeout: 10000 })
  await page.waitForTimeout(1000)
  await page.locator('[data-testid^="room-card-"]').filter({ hasText: "Testing" }).click()
  await expect(page.getByTestId("voice-call-view")).toBeVisible()
  await page.waitForTimeout(3000)
  const count3 = await countPlayingAudio()
  console.log(`Playing audio elements: ${count3}`)

  console.log(`\n=== Summary ===`)
  console.log(`After 1st join: ${count1} playing audio`)
  console.log(`After 2nd join: ${count2} playing audio`)
  console.log(`After 3rd join: ${count3} playing audio`)

  // Audio count should be consistent (not accumulating)
  expect(count2).toBeLessThanOrEqual(count1 + 1) // Allow some variance
  expect(count3).toBeLessThanOrEqual(count2 + 1)

  await ctx.close()
})

test("staggered join - one user joins before another", async ({ browser }) => {
  const ctxA = await browser.newContext({ permissions: ["microphone"] })
  const ctxB = await browser.newContext({ permissions: ["microphone"] })
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  const joinRoom = async (page: typeof pageA, delay: number) => {
    await page.goto("http://localhost:3000/")
    await page.getByRole("button", { name: "Continue as Guest" }).click()
    await page.waitForSelector("text=Available Rooms", { timeout: 10000 })
    await page.waitForTimeout(delay)
    await page.locator('[data-testid^="room-card-"]').filter({ hasText: "Testing" }).click()
    await expect(page.getByTestId("voice-call-view")).toBeVisible()
  }

  const analyzeAudio = async (page: typeof pageA, deviceName: string) => {
    return await page.evaluate(() => {
      const playingAudios = Array.from(document.querySelectorAll("audio")).filter(
        (el) => (el as HTMLAudioElement).srcObject !== null,
      )
      return {
        count: playingAudios.length,
        ids: playingAudios.map((el) => (el as HTMLAudioElement).id),
      }
    })
  }

  // Device A joins first
  console.log("\n=== Device A joining ===")
  await joinRoom(pageA, 0)
  await pageA.waitForTimeout(2000)
  const audioA1 = await analyzeAudio(pageA, "Device A")
  console.log(`Device A: ${audioA1.count} playing audio, IDs: ${audioA1.ids.join(", ")}`)

  // Device B joins 3 seconds later
  console.log("\n=== Device B joining (3s later) ===")
  await joinRoom(pageB, 0)
  await pageB.waitForTimeout(2000)
  await pageA.waitForTimeout(2000)

  const audioA2 = await analyzeAudio(pageA, "Device A")
  const audioB = await analyzeAudio(pageB, "Device B")

  console.log(`Device A: ${audioA2.count} playing audio, IDs: ${audioA2.ids.join(", ")}`)
  console.log(`Device B: ${audioB.count} playing audio, IDs: ${audioB.ids.join(", ")}`)

  // Check that no user ID appears more than once (no duplicates = no feedback loop)
  const checkDuplicates = (ids: string[], deviceName: string) => {
    const uniqueIds = new Set(ids)
    if (ids.length !== uniqueIds.size) {
      console.log(`\n🐛 ${deviceName}: Duplicate audio IDs found!`)
      console.log(`  Total: ${ids.length}, Unique: ${uniqueIds.size}`)
      return true
    }
    return false
  }

  const hasDuplicatesA = checkDuplicates(audioA2.ids, "Device A")
  const hasDuplicatesB = checkDuplicates(audioB.ids, "Device B")

  expect(hasDuplicatesA).toBe(false)
  expect(hasDuplicatesB).toBe(false)

  await ctxA.close()
  await ctxB.close()
})

test("debug: check component visibility and audio stream assignment", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["microphone"] })
  const page = await ctx.newPage()

  await page.goto("http://localhost:3000/")
  await page.getByRole("button", { name: "Continue as Guest" }).click()
  await page.waitForSelector("text=Available Rooms", { timeout: 10000 })
  await page.locator('[data-testid^="room-card-"]').filter({ hasText: "Testing" }).click()
  await expect(page.getByTestId("voice-call-view")).toBeVisible()
  await page.waitForTimeout(3000)

  // Detailed analysis of visibility and stream assignment
  const visibilityAnalysis = await page.evaluate(() => {
    const results: Array<{
      userId: string
      component: string
      isVisible: boolean
      streamAttached: boolean
      parentDisplay: string
      parentVisibility: string
      parentClasses: string
    }> = []

    // Find all participant cards
    document.querySelectorAll(".participant-card").forEach((card) => {
      const audioEl = card.querySelector("audio") as HTMLAudioElement
      const userId = audioEl?.id?.replace("audio-", "") || "unknown"

      // Walk up DOM to find parent component
      let parent = card.parentElement
      let componentName = "unknown"
      let parentDisplay = ""
      let parentVisibility = ""
      let parentClasses = ""

      while (parent) {
        const classes = parent.className || ""
        const computedStyle = window.getComputedStyle(parent)

        if (classes.includes("screen-share-area")) {
          componentName = "ScreenShareArea"
          parentDisplay = computedStyle.display
          parentVisibility = computedStyle.visibility
          parentClasses = classes.slice(0, 100)
          break
        } else if (
          classes.includes("grid") &&
          classes.includes("gap-4") &&
          parent.tagName === "DIV"
        ) {
          // Check if this is inside UserGrid by looking for the v-show wrapper
          const wrapper = parent.parentElement
          if (wrapper) {
            const wrapperStyle = window.getComputedStyle(wrapper)
            componentName = "UserGrid"
            parentDisplay = wrapperStyle.display
            parentVisibility = wrapperStyle.visibility
            parentClasses = wrapper.className?.slice(0, 100) || ""
          }
          break
        }
        parent = parent.parentElement
      }

      results.push({
        userId,
        component: componentName,
        isVisible: parentDisplay !== "none",
        streamAttached: audioEl?.srcObject !== null,
        parentDisplay,
        parentVisibility,
        parentClasses,
      })
    })

    return results
  })

  console.log("\n=== Visibility Analysis ===")
  console.table(visibilityAnalysis)

  // Check for the bug: hidden components with playing audio
  const bugs = visibilityAnalysis.filter((item) => !item.isVisible && item.streamAttached)

  if (bugs.length > 0) {
    console.log("\n🐛 BUG: Hidden components with audio playing:")
    bugs.forEach((bug) => {
      console.log(
        `  User ${bug.userId} in ${bug.component}: hidden=${!bug.isVisible}, streamAttached=${bug.streamAttached}`,
      )
    })
  }

  // Check for duplicate users across visible components
  const visibleUsers = visibilityAnalysis.filter((item) => item.isVisible && item.streamAttached)
  const userCounts: Record<string, number> = {}
  visibleUsers.forEach((item) => {
    userCounts[item.userId] = (userCounts[item.userId] || 0) + 1
  })

  const duplicates = Object.entries(userCounts).filter(([_, count]) => count > 1)
  if (duplicates.length > 0) {
    console.log("\n🐛 BUG: Users appearing multiple times with playing audio:")
    duplicates.forEach(([userId, count]) => {
      console.log(`  User ${userId}: ${count} times`)
    })
  }

  expect(bugs.length).toBe(0)
  duplicates.forEach(([_, count]) => {
    expect(count).toBe(1)
  })

  await ctx.close()
})
