// Live text channel checks against a running backend with real Meilisearch.
// Run through `make e2e-textchat` (scripts/e2e-textchat.sh), which starts a
// throwaway backend with its own database and index and cleans up after.
//
// Usage: node scripts/e2e-textchat.mjs <base-url> <sqlite-db-path>
// The database is needed to promote the "owner" user to super admin.
import { execFileSync } from "node:child_process"

const [BASE, DB] = process.argv.slice(2)
if (!BASE || !DB) {
  console.error("usage: node scripts/e2e-textchat.mjs <base-url> <sqlite-db-path>")
  process.exit(2)
}
const WS_BASE = BASE.replace(/^http/, "ws")
const PASSWORD = "e2e-password-123"

const results = []
function check(name, ok, extra = "") {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && extra ? ` — ${extra.slice(0, 300)}` : ""}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON (plain error text)
  }
  return { status: res.status, json, text }
}

async function user(nickname) {
  await api("POST", "/api/auth/register", null, {
    email: `${nickname}@e2e.test`,
    nickname,
    password: PASSWORD,
  })
  if (nickname === "owner") {
    execFileSync("sqlite3", [DB, "UPDATE users SET role='super_admin' WHERE nickname='owner'"])
  }
  const r = await api("POST", "/api/auth/login", null, { login: nickname, password: PASSWORD })
  if (!r.json?.token) throw new Error(`login ${nickname} failed: ${r.status} ${r.text}`)
  return { token: r.json.token, id: r.json.user.id }
}

function socket(token) {
  const ws = new WebSocket(`${WS_BASE}/ws?token=${token}`)
  const inbox = []
  ws.onmessage = (e) => inbox.push(JSON.parse(e.data))
  return {
    ws,
    ready: new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    }),
    send: (type, data) => ws.send(JSON.stringify({ type, data })),
    /** Removes and returns the queued messages of one type. */
    take: (type) => {
      const out = inbox.filter((m) => m.type === type)
      for (const m of out) inbox.splice(inbox.indexOf(m), 1)
      return out
    },
  }
}

// 1x1 PNG: real image bytes for the sniffer and the thumbnailer.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

async function upload(token, bytes, filename) {
  const form = new FormData()
  form.append("file", new Blob([bytes]), filename)
  const res = await fetch(`${BASE}/api/rooms/${roomId}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // plain error text
  }
  return { status: res.status, json, text }
}

/** Attachments against real S3 (dev Garage); skipped when the backend has them off. */
async function attachmentChecks() {
  const cfg = await api("GET", "/api/config", alice.token)
  if (!cfg.json?.attachments) {
    console.log("SKIP attachments — disabled on the backend (make garage-up, GARAGE_DEFAULT_* in .env)")
    return
  }
  const up = await upload(alice.token, PNG, "dot.png")
  check(
    "upload image",
    up.status === 201 && up.json?.attachment?.kind === "image" && !!up.json?.upload_id,
    up.text,
  )
  const fake = await upload(bob.token, Buffer.from("not an image at all"), "fake.png")
  check("upload sniffs content, not the name", fake.status === 415, fake.text)

  const uploadId = up.json.upload_id
  wsBob.take("text_message_new")
  wsBob.take("text_error")
  wsBob.send("text_message_send", { room_id: roomId, content: "", upload_ids: [uploadId], nonce: "a0" })
  await sleep(300)
  check(
    "send someone else's upload rejected",
    wsBob.take("text_error").some((m) => m.data.code === "invalid") &&
      wsBob.take("text_message_new").length === 0,
  )
  wsAlice.send("text_message_send", { room_id: roomId, content: "", upload_ids: [uploadId], nonce: "a1" })
  await sleep(400)
  const msg = wsAlice.take("text_message_new").pop()?.data?.message
  wsBob.take("text_message_new")
  check("attachment-only message", msg?.attachments?.[0]?.id === uploadId, JSON.stringify(msg))

  const urls = await api("POST", "/api/attachments/urls", bob.token, {
    items: [{ id: uploadId, variant: "original" }],
  })
  const signed = urls.json?.urls?.[`${uploadId}:original`]?.url
  const body = signed ? Buffer.from(await (await fetch(signed)).arrayBuffer()) : Buffer.alloc(0)
  check("presigned original served by S3", body.subarray(1, 4).toString() === "PNG", urls.text)

  const bobProtect = await api("PATCH", `/api/attachments/${uploadId}`, bob.token, { protected: true })
  check("protect by non-uploader rejected", bobProtect.status === 403, bobProtect.text)
  const protect = await api("PATCH", `/api/attachments/${uploadId}`, alice.token, { protected: true })
  await sleep(300)
  const updated = wsBob.take("text_message_updated").pop()?.data?.message
  check(
    "uploader protects, lock broadcast",
    protect.status === 200 && updated?.attachments?.[0]?.protected === true,
    protect.text,
  )

  const mine = await api("GET", "/api/me/attachments", alice.token)
  const theirs = await api("GET", "/api/me/attachments", bob.token)
  const usage = await api("GET", "/api/me/attachments/usage", alice.token)
  check(
    "storage page lists own files only",
    mine.json?.items?.some((i) => i.id === uploadId) && !theirs.json?.items?.some((i) => i.id === uploadId),
    mine.text,
  )
  check(
    "usage counts the file",
    usage.json?.count === 1 && usage.json?.protected_bytes === usage.json?.used_bytes,
    usage.text,
  )

  // Deleting the message purges its files: URLs go, the S3 object goes.
  wsAlice.send("text_message_delete", { message_id: msg.id })
  await sleep(400)
  const after = await api("POST", "/api/attachments/urls", bob.token, {
    items: [{ id: uploadId, variant: "original" }],
  })
  check("deleted message: file gone", after.json?.gone?.includes(uploadId), after.text)
  let purged = false
  for (let i = 0; i < 20 && !purged; i++) {
    purged = (await fetch(signed)).status === 404
    if (!purged) await sleep(250)
  }
  check("S3 object purged", purged)
  const freed = await api("GET", "/api/me/attachments/usage", alice.token)
  check("quota freed", freed.json?.used_bytes === 0, freed.text)
}

const owner = await user("owner")
const alice = await user("alice")
const bob = await user("bob")

const room = await api("POST", "/api/rooms", owner.token, {
  name: "e2e-chat",
  type: "text",
  max_users: 10,
})
check("create text channel", room.status === 200 || room.status === 201, room.text)
const roomId = room.json.id

const sockets = [socket(owner.token), socket(alice.token), socket(bob.token)]
const [wsOwner, wsAlice, wsBob] = sockets
await Promise.all(sockets.map((s) => s.ready))
await sleep(300)

try {
  // Real user ids are padded base64 ("…Wg=="): mentions must survive that.
  wsAlice.send("text_message_send", {
    room_id: roomId,
    content: `hey <@${bob.id}> check the квитанция`,
    nonce: "n1",
  })
  await sleep(400)
  const created = wsAlice.take("text_message_new")[0]?.data?.message
  check("send + nonce echo", !!created)
  check("mention stored", created?.mention_user_ids?.includes(bob.id), JSON.stringify(created))
  check("mentioned user pinged", wsBob.take("text_mention").length === 1)
  check("sender not pinged", wsAlice.take("text_mention").length === 0)

  wsAlice.send("text_typing", { room_id: roomId })
  await sleep(200)
  check("typing reaches others", wsBob.take("text_typing").length === 1)

  wsBob.send("text_reaction_toggle", { message_id: created.id, emoji: "👍" })
  await sleep(300)
  const reacted = wsAlice.take("text_message_updated").pop()?.data?.message
  check("reaction broadcast", reacted?.reactions?.[0]?.user_ids?.includes(bob.id))

  wsBob.send("text_pin", { message_id: created.id, pinned: true })
  await sleep(300)
  check(
    "pin denied without ManageMessages",
    wsBob.take("text_error").some((m) => m.data.code === "forbidden"),
  )
  wsOwner.send("text_pin", { message_id: created.id, pinned: true })
  await sleep(300)
  const pinned = wsAlice.take("text_message_updated").pop()?.data?.message
  check("owner pins", pinned?.pinned === true && pinned?.pinned_by === owner.id)

  // Let Meilisearch apply the writes before index-backed reads.
  await sleep(800)
  const unread = await api("GET", "/api/chat/unread", bob.token)
  const ch = unread.json?.channels?.find((c) => c.room_id === roomId)
  check("unread mention_count", ch?.mention_count === 1 && ch?.notify_mode === "all", unread.text)

  const pins = await api("GET", `/api/rooms/${roomId}/pins`, bob.token)
  check("pins endpoint", pins.json?.messages?.length === 1, pins.text)

  const search = (q, extra = "") =>
    api("GET", `/api/chat/search?q=${encodeURIComponent(q)}&tz=Europe/Moscow${extra}`, bob.token)
  const s1 = await search("квитонция from:alice in:e2e-chat")
  check(
    "search: typo + from + in, highlighted",
    s1.json?.hits?.length === 1 && s1.json.hits[0].snippet.includes("\u0001"),
    s1.text,
  )
  const s2 = await search("from:nobody hey")
  check("search: unknown author hint", s2.json?.hits?.length === 0 && s2.json?.hints?.length === 1)
  const s3 = await search("pinned:true during:today", "&sort=newest")
  check("search: filters only", s3.json?.hits?.length === 1, s3.text)

  const mute = await api("PUT", `/api/rooms/${roomId}/notify`, bob.token, {
    mode: "muted",
    mute_duration: "1h",
  })
  await sleep(200)
  check("mute set", mute.status === 200 && mute.json?.muted_until > Date.now(), mute.text)
  check("notify settings pushed", wsBob.take("text_notify_settings").length === 1)
  wsAlice.send("text_message_send", { room_id: roomId, content: `<@${bob.id}> again`, nonce: "n2" })
  await sleep(400)
  check("muted: no ping", wsBob.take("text_mention").length === 0)
  const bad = await api("PUT", `/api/rooms/${roomId}/notify`, bob.token, {
    mode: "muted",
    mute_duration: "2h",
  })
  check("bad mute duration rejected", bad.status === 400)
  await api("PUT", `/api/rooms/${roomId}/notify`, bob.token, { mode: "all" })

  wsAlice.send("text_message_send", { room_id: roomId, content: "<@&everyone> hi", nonce: "n3" })
  await sleep(400)
  const sys = wsAlice.take("text_message_new").pop()?.data?.message
  check(
    "@everyone dropped, nobody pinged",
    sys?.mention_role_ids?.length === 0 && wsBob.take("text_mention").length === 0,
  )

  wsAlice.send("text_message_edit", { message_id: created.id, content: "edited by alice" })
  wsBob.send("text_message_edit", { message_id: created.id, content: "hijack" })
  await sleep(300)
  check(
    "edit by non-author rejected",
    wsBob.take("text_error").some((m) => m.data.code === "forbidden"),
  )
  wsBob.send("text_message_delete", { message_id: created.id })
  await sleep(300)
  check(
    "delete by non-author rejected",
    wsBob.take("text_error").some((m) => m.data.code === "forbidden"),
  )

  await attachmentChecks()
} finally {
  for (const s of sockets) s.ws.close()
  await api("DELETE", `/api/rooms/${roomId}`, owner.token)
}

const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
