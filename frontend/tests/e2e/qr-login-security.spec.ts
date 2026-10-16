import { expect, test } from "@playwright/test"
import type { APIRequestContext } from "@playwright/test"
import { ensureUser, guestLogin, injectSession } from "./_helpers"

const BACKEND_URL = "http://127.0.0.1:8080"

// A structurally valid 32-byte X25519 public key (base64), reused across cases.
const VALID_PUBLIC_KEY = "nkotje9/qlP7QjgvmpuYgD5S8J29abASkKOruu5SYDE="
const WRONG_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

// The backend is only reachable through the reverse proxy and trusts
// X-Forwarded-For, so each test claims its own synthetic client IP. This keeps
// the per-IP rate-limit buckets independent and stops one test from exhausting
// another's budget.
function clientHeaders(ip: string): Record<string, string> {
  return { "X-Forwarded-For": ip }
}

async function newUser(request: APIRequestContext, nickname: string) {
  return ensureUser(request, {
    email: `${nickname.toLowerCase()}@orbital-e2e.test`,
    nickname,
  })
}

async function createChallenge(
  request: APIRequestContext,
  ip: string,
  overrides: { publicKey?: string; deviceName?: string; deviceInfo?: string } = {},
) {
  return request.post(`${BACKEND_URL}/api/auth/qr/challenge`, {
    headers: clientHeaders(ip),
    data: {
      public_key: overrides.publicKey ?? VALID_PUBLIC_KEY,
      device_name: overrides.deviceName ?? "Security test device",
      device_info: overrides.deviceInfo ?? "",
    },
  })
}

test.describe("QR login security", () => {
  // A2/A3: only a logged-in session may read challenge metadata or approve.
  test("scanner metadata and approval require a session", async ({ request }) => {
    const get = await request.get(`${BACKEND_URL}/api/auth/qr/challenge/anything`, {
      headers: clientHeaders("10.9.1.1"),
    })
    expect(get.status()).toBe(401)

    const approve = await request.post(`${BACKEND_URL}/api/auth/qr/approve`, {
      headers: clientHeaders("10.9.1.2"),
      data: { challenge_id: "anything", public_key: VALID_PUBLIC_KEY },
    })
    expect(approve.status()).toBe(401)
  })

  // A4: guest sessions must never be able to link a device.
  test("guest sessions cannot approve device linking", async ({ request }) => {
    const ip = "10.9.2.1"
    const created = await createChallenge(request, ip)
    expect(created.ok()).toBe(true)
    const { challenge_id } = await created.json()

    const guest = await guestLogin(request)
    const res = await request.post(`${BACKEND_URL}/api/auth/qr/approve`, {
      headers: { ...clientHeaders(ip), Authorization: `Bearer ${guest.token}` },
      data: { challenge_id, public_key: VALID_PUBLIC_KEY },
    })
    expect(res.status()).toBe(403)
  })

  // A1: challenge ids are unguessable and oversized ids are rejected outright.
  test("unknown and oversized challenge ids are not usable", async ({ request }) => {
    const user = await newUser(request, "QRSecEnumerate")
    const ip = "10.9.3.1"

    for (const id of ["does-not-exist", "a".repeat(200)]) {
      const claim = await request.post(`${BACKEND_URL}/api/auth/qr/claim`, {
        headers: clientHeaders(ip),
        data: { challenge_id: id },
      })
      expect(claim.status(), `claim ${id.slice(0, 12)}…`).toBe(404)

      const get = await request.get(
        `${BACKEND_URL}/api/auth/qr/challenge/${encodeURIComponent(id)}`,
        { headers: { ...clientHeaders(ip), Authorization: `Bearer ${user.token}` } },
      )
      expect(get.status(), `get ${id.slice(0, 12)}…`).toBe(404)
    }
  })

  // A14: a malformed public key is refused at creation time.
  test("challenge creation rejects a malformed public key", async ({ request }) => {
    const res = await createChallenge(request, "10.9.4.1", { publicKey: "not-a-key" })
    expect(res.status()).toBe(400)
  })

  // A5: approval is bound to the key the QR code carried.
  test("approval rejects a public key that does not match the challenge", async ({ request }) => {
    const user = await newUser(request, "QRSecKeyMismatch")
    const ip = "10.9.5.1"
    const created = await createChallenge(request, ip)
    const { challenge_id } = await created.json()

    const res = await request.post(`${BACKEND_URL}/api/auth/qr/approve`, {
      headers: { ...clientHeaders(ip), Authorization: `Bearer ${user.token}` },
      data: { challenge_id, public_key: WRONG_PUBLIC_KEY },
    })
    expect(res.status()).toBe(400)
  })

  // A7/A8/A10/A11: single-use lifecycle and no leakage/caching of the payload.
  test("approval and claim are single-use and never leak the sealed payload", async ({
    request,
  }) => {
    const user = await newUser(request, "QRSecSingleUse")
    const ip = "10.9.6.1"
    const auth = { ...clientHeaders(ip), Authorization: `Bearer ${user.token}` }
    const challengeUrl = (id: string) =>
      `${BACKEND_URL}/api/auth/qr/challenge/${encodeURIComponent(id)}`

    const created = await createChallenge(request, ip)
    expect(created.ok()).toBe(true)
    expect(created.headers()["cache-control"]).toContain("no-store")
    const { challenge_id } = await created.json()

    // Scanner view: metadata only, matching key, no sealed payload.
    const viewRes = await request.get(challengeUrl(challenge_id), { headers: auth })
    expect(viewRes.status()).toBe(200)
    expect(viewRes.headers()["cache-control"]).toContain("no-store")
    const view = await viewRes.json()
    expect(view.public_key).toBe(VALID_PUBLIC_KEY)
    expect(view.status).toBe("pending")
    expect(view).not.toHaveProperty("sealed_payload")

    // Polling before approval: 202, uncacheable, still no payload.
    const pending = await request.post(`${BACKEND_URL}/api/auth/qr/claim`, {
      headers: clientHeaders(ip),
      data: { challenge_id },
    })
    expect(pending.status()).toBe(202)
    expect(pending.headers()["cache-control"]).toContain("no-store")
    expect(await pending.text()).not.toContain("sealed_payload")

    // Approve, then confirm the scanner view still hides the payload.
    const approve = await request.post(`${BACKEND_URL}/api/auth/qr/approve`, {
      headers: auth,
      data: { challenge_id, public_key: VALID_PUBLIC_KEY },
    })
    expect(approve.status()).toBe(200)

    const viewAfter = await request.get(challengeUrl(challenge_id), { headers: auth })
    expect(viewAfter.status()).toBe(200)
    expect(await viewAfter.json()).not.toHaveProperty("sealed_payload")

    // Claim delivers the sealed payload exactly once.
    const claim = await request.post(`${BACKEND_URL}/api/auth/qr/claim`, {
      headers: clientHeaders(ip),
      data: { challenge_id },
    })
    expect(claim.status()).toBe(200)
    expect(claim.headers()["cache-control"]).toContain("no-store")
    const claimed = await claim.json()
    expect(claimed.status).toBe("approved")
    expect(typeof claimed.sealed_payload).toBe("string")
    expect(claimed.sealed_payload.length).toBeGreaterThan(0)

    // Replaying either side of the handshake fails.
    const claimReplay = await request.post(`${BACKEND_URL}/api/auth/qr/claim`, {
      headers: clientHeaders(ip),
      data: { challenge_id },
    })
    expect(claimReplay.status()).toBe(409)

    const approveReplay = await request.post(`${BACKEND_URL}/api/auth/qr/approve`, {
      headers: auth,
      data: { challenge_id, public_key: VALID_PUBLIC_KEY },
    })
    expect(approveReplay.status()).toBe(409)
  })

  // A14: attacker-controlled metadata cannot be stored unbounded.
  test("oversized device metadata is truncated", async ({ request }) => {
    const user = await newUser(request, "QRSecOversize")
    const ip = "10.9.7.1"
    const created = await createChallenge(request, ip, { deviceInfo: "x".repeat(200 * 1024) })
    expect(created.ok()).toBe(true)
    const { challenge_id } = await created.json()

    const viewRes = await request.get(
      `${BACKEND_URL}/api/auth/qr/challenge/${encodeURIComponent(challenge_id)}`,
      { headers: { ...clientHeaders(ip), Authorization: `Bearer ${user.token}` } },
    )
    expect(viewRes.status()).toBe(200)
    const view = await viewRes.json()
    expect(view.device_info.length).toBeLessThanOrEqual(8192)
  })

  // A12: unauthenticated challenge creation is rate limited per client.
  test("challenge creation is rate limited", async ({ request }) => {
    const ip = "10.9.8.1"
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await createChallenge(request, ip)
      statuses.push(res.status())
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)
  })

  // A13: approval is rate limited per client.
  test("approval is rate limited", async ({ request }) => {
    const user = await newUser(request, "QRSecApproveFlood")
    const ip = "10.9.9.1"
    const headers = { ...clientHeaders(ip), Authorization: `Bearer ${user.token}` }
    const statuses: number[] = []
    for (let i = 0; i < 31; i++) {
      const res = await request.post(`${BACKEND_URL}/api/auth/qr/approve`, {
        headers,
        data: { challenge_id: "does-not-exist", public_key: VALID_PUBLIC_KEY },
      })
      statuses.push(res.status())
    }
    expect(statuses.slice(0, 30)).toEqual(Array(30).fill(404))
    expect(statuses[30]).toBe(429)
  })

  // A4 (defense in depth): the UI never offers the scanner to guest sessions.
  test("guest sessions are not offered the device-linking scanner", async ({ page, request }) => {
    const guest = await guestLogin(request)
    await injectSession(page.context(), {
      id: guest.user.id,
      nickname: guest.user.nickname,
      email: guest.user.email ?? "",
      password: "",
      token: guest.token,
      role: guest.user.role || "guest",
      isGuest: true,
      authProvider: "guest",
    })

    await page.goto("/")
    await page.getByTitle("Settings").click()
    await page.getByText("Security", { exact: true }).click()

    await expect(page.getByText("Guest sessions cannot approve sign-ins.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Scan QR code" })).toHaveCount(0)
  })
})
