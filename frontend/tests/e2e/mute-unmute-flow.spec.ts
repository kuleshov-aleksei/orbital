import { test, expect } from "@playwright/test"
import type { Page } from "@playwright/test"
import {
  assertLiveKitRunning,
  deleteRoom,
  ensureAdmin,
  ensureUser,
  injectSession,
  seedRoom,
} from "./_helpers"

interface ToggleActions {
  mute: () => Promise<void>
  deafen: () => Promise<void>
}

const MUTE_TITLE = { muted: "Unmute (M)", unmuted: "Mute (M)" }
const DEAFEN_TITLE = { deafened: "Undeafen (D)", undeafened: "Deafen (D)" }

const buttonTriggers = (page: Page): ToggleActions => ({
  mute: () => page.getByTestId("audio-controls").getByTestId("mic-mute-button").click(),
  deafen: () => page.getByTestId("audio-controls").getByTestId("audio-deafen-button").click(),
})

const hotkeyTriggers = (page: Page): ToggleActions => ({
  mute: () => page.keyboard.press("m"),
  deafen: () => page.keyboard.press("d"),
})

const assertMuted = async (page: Page, muted: boolean) => {
  await expect(page.getByTestId("audio-controls").getByTestId("mic-mute-button")).toHaveAttribute(
    "title",
    muted ? MUTE_TITLE.muted : MUTE_TITLE.unmuted,
  )
}

const assertDeafened = async (page: Page, deafened: boolean) => {
  await expect(
    page.getByTestId("audio-controls").getByTestId("audio-deafen-button"),
  ).toHaveAttribute("title", deafened ? DEAFEN_TITLE.deafened : DEAFEN_TITLE.undeafened)
}

async function joinRoom(page: Page, roomId: string) {
  await page.getByTestId(`room-card-${roomId}`).click()
  await expect(page.getByTestId("voice-call-view")).toBeVisible()
  // AudioControls is pointer-events-none until the LiveKit connection completes
  await expect(page.getByText("Connecting to voice server...")).toBeHidden({ timeout: 15000 })
}

async function runScenarios(page: Page, trigger: ToggleActions) {
  // Baseline: fresh context starts unmuted + undeafened
  await assertMuted(page, false)
  await assertDeafened(page, false)

  // Scenario 1: mute + unmute, both ways
  await trigger.mute()
  await assertMuted(page, true)
  await trigger.mute()
  await assertMuted(page, false)
  await trigger.mute()
  await assertMuted(page, true)
  await trigger.mute()
  await assertMuted(page, false)

  // Scenario 2: deafen triggers mute + deafen
  await trigger.deafen()
  await assertMuted(page, true)
  await assertDeafened(page, true)

  // Scenario 3: unmute while deafened -> unmutes AND undeafens
  await trigger.mute()
  await assertMuted(page, false)
  await assertDeafened(page, false)

  // Scenario 4: not muted + not deafened -> deafen (triggers mute) -> undeafen (triggers unmute)
  await trigger.deafen()
  await assertMuted(page, true)
  await assertDeafened(page, true)
  await trigger.deafen()
  await assertDeafened(page, false)
  await assertMuted(page, false)

  // Scenario 5: mute -> deafen -> undeafen (does NOT trigger unmute)
  await trigger.mute()
  await assertMuted(page, true)
  await trigger.deafen()
  await assertMuted(page, true)
  await assertDeafened(page, true)
  await trigger.deafen()
  await assertDeafened(page, false)
  await assertMuted(page, true)
}

for (const [name, triggers] of [
  ["via AudioControls buttons", buttonTriggers],
  ["via hotkeys (M / D)", hotkeyTriggers],
] as const) {
  test(`mute/deafen flow ${name}`, async ({ browser, request }) => {
    await assertLiveKitRunning(request)

    const admin = await ensureAdmin(request)
    const user = await ensureUser(request, {
      email: "mute-flow@orbital-e2e.test",
      nickname: "MuteFlow",
    })

    const room = await seedRoom(request, admin.token, { name: "E2E Mute Flow Room" })

    const ctx = await browser.newContext()
    try {
      await injectSession(ctx, user)
      await ctx.grantPermissions(["microphone"])

      const page = await ctx.newPage()
      await page.goto("/")

      await joinRoom(page, room.id)
      await runScenarios(page, triggers(page))
    } finally {
      await ctx.close()
      await deleteRoom(request, room.id, admin.token)
    }
  })
}
