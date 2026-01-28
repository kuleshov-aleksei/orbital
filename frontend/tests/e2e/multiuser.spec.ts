import { test, expect } from '@playwright/test'
import { resetBackend, seedRoom, setUserIdentity } from './_helpers'

test('two users join same room and see each other', async ({ browser, request }) => {
  await resetBackend(request)
  const room = await seedRoom(request, { name: 'E2E Multiuser Room' })

  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()

  await setUserIdentity(ctxA, { id: 'e2e-user-a', nickname: 'Alice' })
  await setUserIdentity(ctxB, { id: 'e2e-user-b', nickname: 'Bob' })

  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  await pageA.goto('/')
  await pageB.goto('/')

  await pageA.getByTestId(`room-card-${room.id}`).click()
  await pageB.getByTestId(`room-card-${room.id}`).click()

  await expect(pageA.getByTestId('user-sidebar')).toBeVisible()
  await expect(pageB.getByTestId('user-sidebar')).toBeVisible()

  // `user-list` is a single container element; assert on individual user cards to avoid
  // array semantics of toContainText() (which expects multiple matched elements).
  await expect(pageA.getByTestId('user-card-e2e-user-a')).toContainText('Alice')
  await expect(pageA.getByTestId('user-card-e2e-user-b')).toContainText('Bob')
  await expect(pageB.getByTestId('user-card-e2e-user-a')).toContainText('Alice')
  await expect(pageB.getByTestId('user-card-e2e-user-b')).toContainText('Bob')

  await ctxA.close()
  await ctxB.close()
})
