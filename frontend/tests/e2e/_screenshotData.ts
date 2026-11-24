import type { APIRequestContext } from "@playwright/test"
import { loginUser, type TestUser } from "./_helpers"

// Shared data for the @screenshot specs: setup-screenshots.spec.ts seeds a
// demo server with it, join-rooms-screenshots.spec.ts logs the same users in.

// make screenshots-seed points these at its throwaway backend.
export const BACKEND_URL = process.env.SEED_BACKEND_URL ?? "http://127.0.0.1:8080"
export const BACKEND_WS_URL = BACKEND_URL.replace(/^http/, "ws")
export const SCREENSHOT_PASSWORD = "P@ssword123"

/** Images for avatars, custom emojis and badges (see setup-screenshots.spec.ts). */
export const FIXTURES_DIR = new URL("./fixtures/screenshots/", import.meta.url)

export interface ScreenshotUser {
  key: string
  nickname: string
  email: string
  /** File name in fixtures/screenshots/avatars without extension; missing = initials. */
  avatar: string
  /** Role names from ROLES, highest first. */
  roles: string[]
  /** Badge name from BADGES shown next to the nickname. */
  badge?: string
  status?: { text: string; emoji: string }
}

export const ADMIN: ScreenshotUser = {
  key: "admin",
  nickname: "AdminUser",
  email: "admin@test.com",
  avatar: "admin",
  roles: ["Doc"],
  badge: "Spotify DJ",
  // `custom:<name>` is resolved to the seeded custom emoji id.
  status: { text: "Calibrating the flux capacitor", emoji: "⚡" },
}

export const USERS: ScreenshotUser[] = [
  {
    key: "rngesus",
    nickname: "RNGESUS",
    email: "user1@test.com",
    avatar: "rngesus",
    roles: ["Time Traveler"],
    badge: "Shark",
    status: { text: "Where we're going we don't need roads", emoji: "🛣️" },
  },
  {
    key: "flex-tape",
    nickname: "Flex Tape",
    email: "user2@test.com",
    avatar: "flex-tape",
    roles: ["Time Traveler"],
    badge: "Spotify DJ",
    status: { text: "Queueing synthwave", emoji: "🎧" },
  },
  {
    key: "chunky-cheese",
    nickname: "Chunky Cheese",
    email: "user3@test.com",
    avatar: "chunky-cheese",
    roles: ["Night Shift"],
    status: { text: "much wow, very ranked", emoji: "custom:doge" },
  },
  {
    key: "muffin",
    nickname: "Muffin",
    email: "user4@test.com",
    avatar: "muffin",
    roles: ["Lurker"],
  },
  {
    key: "garfield",
    nickname: "Garfield",
    email: "user5@test.com",
    avatar: "garfield",
    roles: ["Night Shift"],
    badge: "Shark",
    status: { text: "Hates Mondays", emoji: "🍝" },
  },
  {
    key: "quota",
    nickname: "Quota, Son of Company",
    email: "user6@test.com",
    avatar: "quota",
    // No role: shows the default name color.
    roles: [],
    status: { text: "sus", emoji: "custom:among_us" },
  },
  {
    key: "zavala",
    nickname: "Zavala's Hair",
    email: "user7@test.com",
    avatar: "zavala-hair",
    roles: ["Lurker"],
    status: { text: "Whether we wanted it or not", emoji: "custom:pepe_gamer" },
  },
]

export const ROLES = [
  { name: "Doc", color: "#e67e22" },
  { name: "Time Traveler", color: "#3498db" },
  { name: "Night Shift", color: "#9b59b6" },
  { name: "Lurker", color: "#95a5a6" },
]

export const BADGES = [
  { file: "spotify", name: "Spotify DJ", description: "Runs the music in the call" },
  { file: "shark", name: "Shark", description: "Bites in ranked" },
]

export const CATEGORIES = ["general", "Just Chatting", "Vibing"]

export const VOICE_ROOMS = {
  arc: { name: "⛏️ ARC Gaiders", category: "general" },
  cs2: { name: "♿ CS2 Ranked", category: "general" },
  frogs: { name: "🐸 Frogs", category: "general" },
  lateNight: { name: "🌠 Late Night Chill", category: "Just Chatting" },
  moon: { name: "🚀 To the Moon", category: "Just Chatting" },
  music: { name: "🎵 Music & Vibes", category: "Vibing" },
}

export const TEXT_ROOMS = {
  general: { name: "💬 general-chat", category: "Just Chatting" },
  hillValley: { name: "⚡ hill-valley-1955", category: "Vibing" },
}

export interface LoggedInUser extends ScreenshotUser {
  id: string
  token: string
  role: string
}

/** Logs in the admin and the regular users; throws when one is missing. */
export async function loginAll(request: APIRequestContext): Promise<{
  admin: LoggedInUser
  users: LoggedInUser[]
}> {
  const loginOne = async (u: ScreenshotUser): Promise<LoggedInUser> => {
    const res: TestUser | null =
      (await loginUser(request, u.email, SCREENSHOT_PASSWORD)) ??
      (await loginUser(request, u.nickname, SCREENSHOT_PASSWORD))
    if (!res) {
      throw new Error(`Failed to log in as ${u.nickname}. Run setup-screenshots.spec.ts first.`)
    }
    return { ...u, id: res.id, token: res.token, role: res.role }
  }
  return {
    admin: await loginOne(ADMIN),
    users: await Promise.all(USERS.map(loginOne)),
  }
}
