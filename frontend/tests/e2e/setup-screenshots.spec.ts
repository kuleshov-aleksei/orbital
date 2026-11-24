import { readdir, readFile } from "node:fs/promises"
import { test, type APIRequestContext } from "@playwright/test"
import { loginUser, registerUser } from "./_helpers"
import {
  ADMIN,
  BACKEND_URL,
  BACKEND_WS_URL,
  BADGES,
  CATEGORIES,
  FIXTURES_DIR,
  ROLES,
  SCREENSHOT_PASSWORD,
  TEXT_ROOMS,
  USERS,
  VOICE_ROOMS,
  type LoggedInUser,
  type ScreenshotUser,
} from "./_screenshotData"

// Seeds a demo server for screenshots: categories, voice rooms, text channels
// with a conversation, color roles, badges, custom statuses, custom emojis and
// avatars. Safe to re-run: it only creates what is missing.
//
// Images come from fixtures/screenshots/{avatars,emojis,badges}; a missing
// file is skipped. Text channels need Meilisearch (make meili-up).

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
}

interface FixtureFile {
  base: string
  name: string
  mimeType: string
  buffer: Buffer
}

async function listFixtures(dir: string): Promise<FixtureFile[]> {
  const url = new URL(`${dir}/`, FIXTURES_DIR)
  const names = await readdir(url).catch(() => [] as string[])
  const files: FixtureFile[] = []
  for (const name of names.sort()) {
    const dot = name.lastIndexOf(".")
    const mimeType = MIME[name.slice(dot + 1).toLowerCase()]
    if (dot <= 0 || !mimeType) continue
    files.push({
      base: name.slice(0, dot),
      name,
      mimeType,
      buffer: await readFile(new URL(name, url)),
    })
  }
  return files
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function check(res: Awaited<ReturnType<APIRequestContext["get"]>>, what: string) {
  if (!res.ok()) {
    throw new Error(`${what} failed: ${res.status()} ${await res.text()}`)
  }
  return res
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// --- Text chat over the global WebSocket -----------------------------------

interface ChatMessage {
  id: string
  poll?: { options: Array<{ id: string; text: string }> }
}

/** One user's global socket: sends text_* events and waits for the echo. */
class ChatSocket {
  private ws: WebSocket
  private waiting = new Map<string, (m: ChatMessage) => void>()
  private sent: number[] = []

  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as { type: string; data?: Record<string, unknown> }
      const nonce = msg.data?.nonce as string | undefined
      if (msg.type === "text_message_new" && nonce && this.waiting.has(nonce)) {
        this.waiting.get(nonce)!(msg.data!.message as ChatMessage)
        this.waiting.delete(nonce)
      } else if (msg.type === "text_error") {
        console.log(`text_error: ${JSON.stringify(msg.data)}`)
      }
    })
  }

  static open(token: string): Promise<ChatSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${BACKEND_WS_URL}/ws?token=${encodeURIComponent(token)}`)
      ws.addEventListener("open", () => resolve(new ChatSocket(ws)), { once: true })
      ws.addEventListener("error", () => reject(new Error("WebSocket failed")), { once: true })
    })
  }

  private emit(type: string, data: Record<string, unknown>) {
    this.ws.send(JSON.stringify({ type, data }))
  }

  /** Stays under the server limit of 5 messages per 5 s per channel. */
  private async throttle() {
    const now = Date.now()
    this.sent = this.sent.filter((t) => now - t < 5500)
    if (this.sent.length >= 4) {
      await sleep(5500 - (now - this.sent[0]))
    }
    this.sent.push(Date.now())
  }

  async send(roomId: string, content: string, extra: Record<string, unknown> = {}) {
    await this.throttle()
    const nonce = crypto.randomUUID()
    const echo = new Promise<ChatMessage>((resolve, reject) => {
      this.waiting.set(nonce, resolve)
      setTimeout(() => reject(new Error(`No echo for message "${content}"`)), 10_000)
    })
    this.emit("text_message_send", { room_id: roomId, content, nonce, ...extra })
    const message = await echo
    // Distinct timestamps keep the order stable in the channel.
    await sleep(250)
    return message
  }

  react(messageId: string, emoji: string) {
    this.emit("text_reaction_toggle", { message_id: messageId, emoji })
  }

  vote(messageId: string, optionIds: string[]) {
    this.emit("text_poll_vote", { message_id: messageId, option_ids: optionIds })
  }

  pin(messageId: string) {
    this.emit("text_pin", { message_id: messageId, pinned: true })
  }

  close() {
    this.ws.close()
  }
}

// --- Seeding steps ----------------------------------------------------------

async function ensureAdmin(request: APIRequestContext) {
  let admin = await loginUser(request, ADMIN.nickname, SCREENSHOT_PASSWORD)
  if (!admin) {
    // The first registered account becomes the owner (super_admin).
    await registerUser(request, ADMIN.email, ADMIN.nickname, SCREENSHOT_PASSWORD)
    admin = await loginUser(request, ADMIN.email, SCREENSHOT_PASSWORD)
    console.log(`Created user: ${ADMIN.nickname}`)
  }
  if (!admin) throw new Error(`Failed to log in as ${ADMIN.nickname}`)
  return admin
}

async function ensureUser(request: APIRequestContext, u: ScreenshotUser): Promise<LoggedInUser> {
  let res =
    (await loginUser(request, u.email, SCREENSHOT_PASSWORD)) ??
    (await loginUser(request, u.nickname, SCREENSHOT_PASSWORD))
  if (!res) {
    await registerUser(request, u.email, u.nickname, SCREENSHOT_PASSWORD)
    res = await loginUser(request, u.email, SCREENSHOT_PASSWORD)
    console.log(`Created user: ${u.nickname}`)
  }
  if (!res) throw new Error(`Failed to log in as ${u.nickname}`)
  return { ...u, id: res.id, token: res.token, role: res.role }
}

async function ensureRooms(request: APIRequestContext, token: string, textChannels: boolean) {
  const categories = (await (
    await check(await request.get(`${BACKEND_URL}/api/categories`, { headers: auth(token) }), "List categories")
  ).json()) as Array<{ name: string }>
  for (const name of CATEGORIES) {
    if (categories.some((c) => c.name === name)) continue
    await check(
      await request.post(`${BACKEND_URL}/api/categories`, { headers: auth(token), data: { name } }),
      `Create category ${name}`,
    )
    console.log(`Created category: ${name}`)
  }

  const listRooms = async () =>
    (await (
      await check(await request.get(`${BACKEND_URL}/api/rooms`, { headers: auth(token) }), "List rooms")
    ).json()) as Array<{ id: string; name: string }>
  const existing = await listRooms()

  const wanted = [
    ...Object.values(VOICE_ROOMS).map((r) => ({ ...r, type: "voice" })),
    ...(textChannels ? Object.values(TEXT_ROOMS).map((r) => ({ ...r, type: "text" })) : []),
  ]
  for (const room of wanted) {
    if (existing.some((r) => r.name === room.name)) continue
    await check(
      await request.post(`${BACKEND_URL}/api/rooms`, {
        headers: auth(token),
        data: { name: room.name, category: room.category, type: room.type },
      }),
      `Create room ${room.name}`,
    )
    console.log(`Created ${room.type} room: ${room.name}`)
  }
  return listRooms()
}

/** Uploads the emojis in fixtures/screenshots/emojis; returns shortcode → id. */
async function ensureEmojis(request: APIRequestContext, token: string) {
  const list = async () =>
    (await (
      await check(await request.get(`${BACKEND_URL}/api/emojis`, { headers: auth(token) }), "List emojis")
    ).json()) as Array<{ id: string; name: string }>
  const existing = await list()
  for (const file of await listFixtures("emojis")) {
    if (existing.some((e) => e.name === file.base)) continue
    await check(
      await request.post(`${BACKEND_URL}/api/emojis`, {
        headers: auth(token),
        multipart: {
          name: file.base,
          image: { name: file.name, mimeType: file.mimeType, buffer: file.buffer },
        },
      }),
      `Upload emoji ${file.name}`,
    )
    console.log(`Created emoji: :${file.base}:`)
  }
  return new Map((await list()).map((e) => [e.name, e.id]))
}

async function ensureAvatars(request: APIRequestContext, users: LoggedInUser[]) {
  const files = await listFixtures("avatars")
  const publicUsers = (await (await request.get(`${BACKEND_URL}/api/users`)).json()) as Array<{
    id: string
    avatar_url?: string
  }>
  for (const user of users) {
    const file = files.find((f) => f.base === user.avatar)
    if (!file || publicUsers.find((p) => p.id === user.id)?.avatar_url) continue
    await check(
      await request.post(`${BACKEND_URL}/api/users/me/avatar`, {
        headers: auth(user.token),
        multipart: { avatar: { name: file.name, mimeType: file.mimeType, buffer: file.buffer } },
      }),
      `Upload avatar for ${user.nickname}`,
    )
    console.log(`Set avatar: ${user.nickname}`)
  }
}

async function ensureRoles(request: APIRequestContext, token: string, users: LoggedInUser[]) {
  const list = async () =>
    (await (
      await check(await request.get(`${BACKEND_URL}/api/roles`, { headers: auth(token) }), "List roles")
    ).json()) as {
      roles: Array<{ id: string; name: string }>
      user_roles: Record<string, string[]>
    }
  let current = await list()
  // A new role goes to the bottom, so creating them in order keeps ROLES[0] highest.
  for (const role of ROLES) {
    if (current.roles.some((r) => r.name === role.name)) continue
    await check(
      await request.post(`${BACKEND_URL}/api/roles`, {
        headers: auth(token),
        data: { name: role.name, color: role.color, permissions: 0, deny_permissions: 0 },
      }),
      `Create role ${role.name}`,
    )
    console.log(`Created role: ${role.name}`)
  }
  current = await list()
  const idOf = new Map(current.roles.map((r) => [r.name, r.id]))

  for (const user of users) {
    const held = current.user_roles[user.id] ?? []
    const wanted = user.roles.map((name) => idOf.get(name)!).filter(Boolean)
    if (wanted.every((id) => held.includes(id))) continue
    await check(
      await request.put(`${BACKEND_URL}/api/users/${encodeURIComponent(user.id)}/roles`, {
        headers: auth(token),
        // Replaces the set: keep whatever else the user already holds.
        data: { role_ids: [...new Set([...held, ...wanted])] },
      }),
      `Assign roles to ${user.nickname}`,
    )
    console.log(`Assigned roles to ${user.nickname}: ${user.roles.join(", ")}`)
  }
}

async function ensureBadges(request: APIRequestContext, token: string, users: LoggedInUser[]) {
  const list = async () =>
    (await (
      await check(await request.get(`${BACKEND_URL}/api/badges`, { headers: auth(token) }), "List badges")
    ).json()) as Array<{ id: string; name: string }>
  const existing = await list()
  const files = await listFixtures("badges")
  for (const badge of BADGES) {
    const file = files.find((f) => f.base === badge.file)
    if (!file || existing.some((b) => b.name === badge.name)) continue
    await check(
      await request.post(`${BACKEND_URL}/api/admin/badges`, {
        headers: auth(token),
        multipart: {
          name: badge.name,
          description: badge.description,
          image: { name: file.name, mimeType: file.mimeType, buffer: file.buffer },
        },
      }),
      `Create badge ${badge.name}`,
    )
    console.log(`Created badge: ${badge.name}`)
  }
  const idOf = new Map((await list()).map((b) => [b.name, b.id]))

  for (const user of users) {
    const badgeId = user.badge && idOf.get(user.badge)
    if (!badgeId) continue
    await check(
      await request.put(`${BACKEND_URL}/api/admin/users/${encodeURIComponent(user.id)}/badges`, {
        headers: auth(token),
        data: { badge_ids: [badgeId] },
      }),
      `Grant badge to ${user.nickname}`,
    )
    await check(
      await request.put(`${BACKEND_URL}/api/users/me/displayed-badge`, {
        headers: auth(user.token),
        data: { badge_id: badgeId },
      }),
      `Display badge for ${user.nickname}`,
    )
  }
  console.log("Badges granted")
}

async function ensureStatuses(
  request: APIRequestContext,
  users: LoggedInUser[],
  emojis: Map<string, string>,
) {
  for (const user of users) {
    if (!user.status) continue
    let emoji = user.status.emoji
    if (emoji.startsWith("custom:")) {
      const id = emojis.get(emoji.slice("custom:".length))
      if (!id) continue
      emoji = `custom:${id}`
    }
    await check(
      await request.patch(`${BACKEND_URL}/api/users/me/custom-status`, {
        headers: auth(user.token),
        data: { custom_status: user.status.text, custom_status_emoji: emoji },
      }),
      `Set status for ${user.nickname}`,
    )
  }
  console.log("Statuses set")
}

// --- Conversations ----------------------------------------------------------

async function seedChats(
  request: APIRequestContext,
  everyone: LoggedInUser[],
  rooms: Array<{ id: string; name: string }>,
  emojis: Map<string, string>,
) {
  const isEmpty = async (roomId: string) => {
    const res = await request.get(`${BACKEND_URL}/api/rooms/${roomId}/messages?limit=1`, {
      headers: auth(everyone[0].token),
    })
    if (!res.ok()) return false
    return ((await res.json()) as { messages: unknown[] }).messages.length === 0
  }
  const hillValley = rooms.find((r) => r.name === TEXT_ROOMS.hillValley.name)
  const general = rooms.find((r) => r.name === TEXT_ROOMS.general.name)
  const seedHillValley = hillValley && (await isEmpty(hillValley.id))
  const seedGeneral = general && (await isEmpty(general.id))
  if (!seedHillValley && !seedGeneral) {
    console.log("Text channels already have messages, skipping chat history")
    return
  }

  const sockets = new Map<string, ChatSocket>()
  for (const user of everyone) {
    sockets.set(user.key, await ChatSocket.open(user.token))
  }
  const as = (key: string) => sockets.get(key)!
  // Inline custom emoji token; falls back to the shortcode if it is missing.
  const e = (name: string) => (emojis.has(name) ? `<:${name}:${emojis.get(name)}>` : `:${name}:`)
  const customReaction = (name: string) => (emojis.has(name) ? `custom:${emojis.get(name)}` : "😂")

  try {
    if (seedHillValley) {
      const room = hillValley.id
      const say = (key: string, text: string, extra?: Record<string, unknown>) =>
        as(key).send(room, text, extra)

      const opening = await say("admin", "Great Scott! The new server is finally up 🎉")
      await say("rngesus", "Doc, you built a voice chat... out of a DeLorean?")
      await say("admin", "If you're gonna build a voice chat, why not do it with some style?")
      const gigawatts = await say("flex-tape", "ok but how many gigawatts does the SFU need")
      const answer = await say("admin", "1.21 gigawatts?! 1.21 gigawatts!", {
        reply_to_id: gigawatts.id,
      })
      const doge = await say("chunky-cheese", `${e("doge")} such latency. very low. wow`)
      await say("garfield", "Hello? Hello? Anybody home? Think, McFly. Think! Raid starts at 22:00")
      const heavy = await say("zavala", "This is heavy.")
      await say(
        "rngesus",
        "Why are things so heavy in the future? Is there a problem with the Earth's gravitational pull?",
        { reply_to_id: heavy.id },
      )
      const sus = await say("quota", `whoever left the flux capacitor on is sus ${e("among_us")}`)
      const roads = await say("admin", "Roads? Where we're going, we don't need roads.")
      await say("muffin", "first time talking here, hi 👋")
      const poll = await say("flex-tape", "", {
        poll: {
          question: "Where do we go tonight?",
          options: ["1955", "1985", "2015"],
          multiple: false,
          anonymous: false,
          allow_change: true,
        },
      })
      await say("garfield", `Nobody calls me chicken. Except on Mondays ${e("pepe_gamer")}`)
      await say("admin", "When this baby hits 88 miles per hour, you're gonna see some serious ping")

      // Reactions, votes and a pin.
      for (const key of ["rngesus", "flex-tape", "garfield", "muffin"]) as(key).react(opening.id, "🎉")
      for (const key of ["flex-tape", "zavala"]) as(key).react(answer.id, "⚡")
      for (const key of ["admin", "quota", "garfield"]) as(key).react(doge.id, customReaction("doge"))
      for (const key of ["rngesus", "chunky-cheese"]) as(key).react(sus.id, customReaction("among_us"))
      as("garfield").react(heavy.id, customReaction("pepe_gamer"))
      for (const key of ["rngesus", "flex-tape", "chunky-cheese", "zavala", "muffin"])
        as(key).react(roads.id, "🔥")

      const options = poll.poll?.options ?? []
      const votes: Record<string, string> = {
        admin: "2015",
        rngesus: "1985",
        "chunky-cheese": "1955",
        garfield: "2015",
        zavala: "2015",
      }
      for (const [key, text] of Object.entries(votes)) {
        const option = options.find((o) => o.text === text)
        if (option) as(key).vote(poll.id, [option.id])
      }
      as("admin").pin(roads.id)
      console.log(`Seeded chat: ${TEXT_ROOMS.hillValley.name}`)
    }

    if (seedGeneral) {
      const room = general.id
      const ask = await as("muffin").send(room, "anyone up for ARC tonight?")
      await as("rngesus").send(room, "after I lose this CS2 game, yes", { reply_to_id: ask.id })
      await as("garfield").send(room, "only if someone brings lasagna 🍝")
      await as("quota").send(room, `${e("pepe_gamer")} ready`)
      const music = await as("flex-tape").send(room, "putting some synthwave on in 🎵 Music & Vibes")
      for (const key of ["muffin", "zavala", "admin"]) as(key).react(music.id, "🎶")
      console.log(`Seeded chat: ${TEXT_ROOMS.general.name}`)
    }

    // Let the fire-and-forget reactions, votes and pin reach the server.
    await sleep(1500)
  } finally {
    for (const socket of sockets.values()) socket.close()
  }
}

test("setup: seed a demo server for screenshots @screenshot", async ({ request }) => {
  test.setTimeout(180_000)

  const adminLogin = await ensureAdmin(request)
  if (adminLogin.role !== "super_admin") {
    console.log(
      `${ADMIN.nickname} has role '${adminLogin.role}', not super_admin. ` +
        "Run this against a fresh database (the first account becomes the owner).",
    )
    return
  }
  const admin: LoggedInUser = { ...ADMIN, id: adminLogin.id, token: adminLogin.token, role: adminLogin.role }
  console.log("Admin user OK")

  const health = (await (await request.get(`${BACKEND_URL}/api/health`)).json()) as {
    text_channels?: string
  }
  const textChannels = health.text_channels === "ok"
  if (!textChannels) {
    console.log(`Text channels are '${health.text_channels}': skipping chats (make meili-up)`)
  }

  const rooms = await ensureRooms(request, admin.token, textChannels)

  const users: LoggedInUser[] = []
  for (const u of USERS) users.push(await ensureUser(request, u))
  const everyone = [admin, ...users]

  const emojis = await ensureEmojis(request, admin.token)
  await ensureAvatars(request, everyone)
  await ensureRoles(request, admin.token, everyone)
  await ensureBadges(request, admin.token, everyone)
  await ensureStatuses(request, everyone, emojis)
  if (textChannels) {
    await seedChats(request, everyone, rooms, emojis)
  }

  console.log("Setup complete!")
})
