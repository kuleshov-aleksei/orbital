import { test } from "@playwright/test"
import { registerUser } from "./_helpers"

const ADMIN_NICKNAME = "AdminUser"
const ADMIN_PASSWORD = "P@ssword123"

const NICKNAMES = [
  "RNGESUS",
  "Flex Tape",
  "Chunky Cheese",
  "Muffin",
  "Garfield",
  "Quota, Son of Company",
  "Zavala's Hair",
]

test("setup: create categories, rooms and 7 regular users", async ({ request }) => {
  const loginRes = await request.post("http://127.0.0.1:8080/api/auth/login", {
    data: { login: ADMIN_NICKNAME, password: ADMIN_PASSWORD },
  })

  if (!loginRes.ok()) {
    console.log(
      "Admin user not found. Create AdminUser manually and grant admin rights, then re-run.",
    )
    return
  }

  const loginData = (await loginRes.json()) as {
    token: string
    user: { id: string; nickname: string; role: string }
  }
  const adminUser = { user: loginData.user, token: loginData.token }

  const userRole = loginData.user.role
  if (userRole !== "admin" && userRole !== "super_admin") {
    console.log(`AdminUser has role '${userRole}', not admin. Grant admin rights, then re-run.`)
    return
  }

  console.log(`Admin user OK (role: ${userRole})`)

  // Check if categories and rooms exist
  const categoriesResponse = await request.get("http://127.0.0.1:8080/api/categories")
  const existingCategories = (await categoriesResponse.json()) as Array<{ name: string }>

  const roomsResponse = await request.get("http://127.0.0.1:8080/api/rooms")
  const existingRooms = (await roomsResponse.json()) as Array<{
    name: string
    category_name: string
  }>

  const requiredCategories = ["general", "Just Chatting", "Vibing"]
  const requiredRooms = [
    { name: "⛏️ ARC Gaiders", category: "general" },
    { name: "♿ CS2 Ranked", category: "general" },
    { name: "🐸 Frogs", category: "general" },
    { name: "🌠 Late Night Chill", category: "Just Chatting" },
    { name: "🚀 To the Moon", category: "Just Chatting" },
    { name: "🎵 Music & Vibes", category: "Vibing" },
  ]

  // Create missing categories
  for (const categoryName of requiredCategories) {
    if (!existingCategories.some((c) => c.name === categoryName)) {
      await request.post("http://127.0.0.1:8080/api/categories", {
        headers: { Authorization: `Bearer ${adminUser.token}` },
        data: { name: categoryName },
      })
      console.log(`Created category: ${categoryName}`)
    }
  }

  // Create missing rooms
  for (const room of requiredRooms) {
    if (!existingRooms.some((r) => r.name === room.name)) {
      await request.post("http://127.0.0.1:8080/api/rooms", {
        headers: { Authorization: `Bearer ${adminUser.token}` },
        data: { name: room.name, category: room.category },
      })
      console.log(`Created room: ${room.name}`)
    }
  }

  // Create users
  const usersRes = await request.get("http://127.0.0.1:8080/api/users")
  const existingUsers = (await usersRes.json()) as Array<{ nickname: string }>
  const existingNicknames = new Set(existingUsers.map((u) => u.nickname))

  for (let i = 0; i < NICKNAMES.length; i++) {
    if (!existingNicknames.has(NICKNAMES[i])) {
      await registerUser(request, `user${i + 1}@test.com`, NICKNAMES[i], ADMIN_PASSWORD)
      console.log(`Created user: ${NICKNAMES[i]}`)
    }
  }

  console.log("Setup complete!")
})
