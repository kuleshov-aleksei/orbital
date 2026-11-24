import { test, expect, type APIRequestContext, type Page } from "@playwright/test"
import {
  ADMIN_EMAIL,
  TEST_PASSWORD,
  deleteRoom,
  ensureAdmin,
  ensureUser,
  loginViaUi,
} from "./_helpers"

const BACKEND_URL = "http://127.0.0.1:8080"

// Polls (docs/specs/CHAT_SYSTEM.md §7.18). Text channels need Meilisearch
// (make meili-up); the test skips without it.

async function skipWithoutTextChannels(request: APIRequestContext) {
  const health = await (await request.get(`${BACKEND_URL}/api/health`)).text()
  test.skip(!health.includes('"text_channels":"ok"'), "text channels are off (make meili-up)")
}

async function createTextRoom(request: APIRequestContext, token: string) {
  const name = `e2e-poll-${Date.now().toString(36)}`
  const res = await request.post(`${BACKEND_URL}/api/rooms`, {
    data: { name, type: "text", max_users: 10 },
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return { name, room: (await res.json()) as { id: string } }
}

/** Fills the creation modal: a question and its answers. */
async function fillPoll(page: Page, question: string, answers: string[]) {
  const modal = page.getByTestId("create-poll-modal")
  await expect(modal).toBeVisible()
  await modal.locator("#poll-question").fill(question)
  for (let i = 0; i < answers.length; i++) {
    // A new empty row appears once the last one is filled.
    await modal.getByTestId("poll-option").nth(i).fill(answers[i])
  }
  await expect(modal.getByTestId("poll-option")).toHaveCount(answers.length + 1)
}

test("create a poll, vote, change the vote, see voters, end it", async ({
  page,
  browser,
  request,
}) => {
  await skipWithoutTextChannels(request)
  const admin = await ensureAdmin(request)
  const voter = await ensureUser(request, {
    email: "poll-voter@orbital-e2e.test",
    nickname: "PollVoter",
  })
  const { name, room } = await createTextRoom(request, admin.token)
  const voterContext = await browser.newContext()
  try {
    await loginViaUi(page, ADMIN_EMAIL, TEST_PASSWORD)
    await page.locator(".room-card").filter({ hasText: name }).click()
    await expect(page.getByTestId("text-channel-view")).toBeVisible()

    // The ➕ button is a menu now.
    await page.getByTestId("composer-plus").click()
    await expect(page.getByTestId("composer-plus-menu")).toBeVisible()
    await page.getByTestId("create-poll-button").click()
    const modal = page.getByTestId("create-poll-modal")
    await expect(modal.getByTestId("poll-submit")).toBeDisabled()
    await fillPoll(page, "Pizza or sushi?", ["Pizza", "Sushi"])
    await modal.getByTestId("poll-duration-1d").click()
    await expect(modal.getByTestId("poll-end-preview")).toContainText("Ends")
    await modal.getByTestId("poll-submit").click()
    await expect(modal).toHaveCount(0)

    const card = page.getByTestId("poll-card")
    await expect(card).toHaveCount(1)
    await expect(card.getByTestId("poll-question-text")).toHaveText("Pizza or sushi?")
    await expect(card.getByTestId("poll-status")).toContainText("Ends in")
    // Results stay hidden until you vote.
    await expect(card).toContainText("Vote to see results")
    await expect(card.getByTestId("poll-option-count")).toHaveCount(0)

    const rows = card.getByTestId("poll-option-row")
    await rows.nth(0).click()
    await expect(card.getByTestId("poll-option-count").nth(0)).toContainText("100%")

    // Change the vote.
    await card.getByTestId("poll-change-vote").click()
    await rows.nth(1).click()
    await expect(card.getByTestId("poll-option-count").nth(1)).toContainText("100%")
    await expect(card.getByTestId("poll-option-count").nth(0)).toContainText("0%")

    // A second user votes from another browser.
    const voterPage = await voterContext.newPage()
    await loginViaUi(voterPage, voter.email, voter.password)
    await voterPage.locator(".room-card").filter({ hasText: name }).click()
    const voterCard = voterPage.getByTestId("poll-card")
    await expect(voterCard).toContainText("Vote to see results")
    await voterCard.getByTestId("poll-option-row").nth(0).click()
    await expect(voterCard.getByTestId("poll-option-count").nth(0)).toContainText("50%")

    // Both votes, and who cast them.
    await expect(card.getByTestId("poll-view-votes")).toHaveText("2 votes")
    await card.getByTestId("poll-view-votes").click()
    const voters = page.getByTestId("poll-voters-modal")
    await expect(voters).toBeVisible()
    await voters.getByTestId("poll-voters-tab").filter({ hasText: "Pizza" }).click()
    await expect(voters.getByTestId("poll-voter")).toHaveText([voter.nickname])
    await page.keyboard.press("Escape")
    await expect(voters).toHaveCount(0)

    // End it early: the poll closes and a system message announces it.
    await card.getByTestId("poll-end").click()
    await card.getByTestId("poll-end-confirm").click()
    await expect(card).toHaveAttribute("data-poll-state", "ended")
    const result = page.getByTestId("poll-closed-card")
    await expect(result).toContainText("Tie")
    await expect(voterPage.getByTestId("poll-closed-card")).toBeVisible()
  } finally {
    await voterContext.close()
    await deleteRoom(request, room.id, admin.token)
  }
})

test.describe("mobile poll creation", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test("the ➕ sheet and the poll modal work on a phone", async ({ page, request }) => {
    await skipWithoutTextChannels(request)
    const admin = await ensureAdmin(request)
    const { name, room } = await createTextRoom(request, admin.token)
    try {
      await page.goto("/")
      await page.locator("#login").fill(ADMIN_EMAIL)
      await page.locator("#password").fill(TEST_PASSWORD)
      await page.locator('form button[type="submit"]').click()
      await page.locator(".room-card:visible").filter({ hasText: name }).click()
      await expect(page.getByTestId("text-channel-view")).toBeVisible()

      await page.getByTestId("composer-plus").click()
      const sheet = page.getByTestId("composer-plus-sheet")
      await expect(sheet).toBeVisible()
      await sheet.getByTestId("create-poll-button").click()
      await fillPoll(page, "Movie night?", ["Friday", "Saturday", "Sunday"])
      const modal = page.getByTestId("create-poll-modal")
      await modal.getByTestId("poll-multiple").click()
      await modal.getByTestId("poll-anonymous").click()
      await modal.getByTestId("poll-submit").click()

      const card = page.getByTestId("poll-card")
      await expect(card).toContainText("Multiple choice")
      await expect(card).toContainText("Anonymous")
      // Multiple choice: tick answers, then Vote.
      await card.getByTestId("poll-option-row").nth(0).click()
      await card.getByTestId("poll-option-row").nth(2).click()
      await card.getByTestId("poll-submit-vote").click()
      await expect(card.getByTestId("poll-option-count")).toHaveCount(3)
      // Anonymous polls never offer the voters list.
      await expect(card.getByTestId("poll-view-votes")).toHaveCount(0)
    } finally {
      await deleteRoom(request, room.id, admin.token)
    }
  })
})
