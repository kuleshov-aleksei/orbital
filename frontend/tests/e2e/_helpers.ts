import type { APIRequestContext, BrowserContext } from "@playwright/test"

const BACKEND_URL = "http://127.0.0.1:8080"

export async function resetBackend(request: APIRequestContext) {
  const res = await request.post(`${BACKEND_URL}/api/test/reset`, {
    headers: {
      "X-Orbital-E2E": "1",
    },
  })
  if (!res.ok()) {
    if (res.status() === 404) {
      throw new Error(
        `Failed to reset backend: 404 ${await res.text()}\n` +
          `The backend on ${BACKEND_URL} does not expose /api/test/reset. ` +
          `Stop any running backend on :8080 and rerun Playwright so it can start the test backend.`,
      )
    }
    throw new Error(
      `Failed to reset backend: ${res.status()} ${await res.text()}`,
    )
  }
}

export async function seedRoom(
  request: APIRequestContext,
  room: { name: string; category?: string; maxUsers?: number },
) {
  const res = await request.post(`${BACKEND_URL}/api/rooms`, {
    data: {
      name: room.name,
      category: room.category ?? "General",
      max_users: room.maxUsers ?? 10,
    },
  })

  if (!res.ok()) {
    throw new Error(
      `Failed to create room: ${res.status()} ${await res.text()}`,
    )
  }

  return (await res.json()) as { id: string; name: string }
}

export async function setUserIdentity(
  context: BrowserContext,
  user: { id: string; nickname: string },
) {
  await context.addInitScript(({ id, nickname }) => {
    localStorage.setItem("orbital_user_id", id)
    localStorage.setItem("orbital_user_nickname", nickname)
  }, user)
}
