import { test, expect } from '@playwright/test'
import { resetBackend } from './_helpers'

test('create room via UI and leave', async ({ page, request }) => {
  await resetBackend(request)

  await page.goto('/')

  await page.getByTestId('create-room-welcome').click()
  await expect(page.getByTestId('room-modal')).toBeVisible()

  await page.getByTestId('room-name-input').fill('E2E Room')
  await page.getByTestId('room-create-submit').click()

  await expect(page.getByTestId('voice-call-view')).toBeVisible()
  await expect(page.getByTestId('room-title')).toHaveText('E2E Room')

  await page.getByTestId('leave-room-header').click()
  await expect(page.getByTestId('welcome-view')).toBeVisible()
})
