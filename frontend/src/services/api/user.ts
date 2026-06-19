import { getAuthToken, API_BASE, apiRequest } from "./client"
import type { AppConfig } from "./client"

export function uploadAvatar(file: File): Promise<{ avatar_url: string }> {
  const formData = new FormData()
  formData.append("avatar", file)

  const token = getAuthToken()
  return fetch(`${API_BASE}/users/me/avatar`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  }).then(async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API Error: ${response.status} - ${errorText}`)
    }
    return response.json()
  })
}

export function updateSoundPack(soundPack: string): Promise<{ sound_pack: string }> {
  const token = getAuthToken()
  return fetch(`${API_BASE}/users/me/sound-pack`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ sound_pack: soundPack }),
  }).then(async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API Error: ${response.status} - ${errorText}`)
    }
    return response.json()
  })
}

export function getConfig(): Promise<AppConfig> {
  return apiRequest<AppConfig>("/config")
}
