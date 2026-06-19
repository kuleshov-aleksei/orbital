import { apiRequest, getAuthToken, API_BASE } from "./client"
import type { User, PublicUser, DebugLog, AudioFile, StatsStatus } from "@/types"

export function getUsers(): Promise<User[]> {
  return apiRequest<User[]>("/admin/users")
}

export function getUserRole(userId: string): Promise<{ role: string }> {
  return apiRequest<{ role: string }>(`/admin/users/${userId}/role`)
}

export function promoteUser(userId: string): Promise<{ status: string; message: string }> {
  return apiRequest<{ status: string; message: string }>(`/admin/users/${userId}/promote`, {
    method: "POST",
  })
}

export function demoteUser(userId: string): Promise<{ status: string; message: string }> {
  return apiRequest<{ status: string; message: string }>(`/admin/users/${userId}/demote`, {
    method: "POST",
  })
}

export function deleteUser(userId: string): Promise<{ status: string; message: string }> {
  return apiRequest<{ status: string; message: string }>(`/admin/users/${userId}`, {
    method: "DELETE",
  })
}

export function deleteAllGuests(): Promise<{
  status: string
  message: string
  deleted_count: number
}> {
  return apiRequest<{ status: string; message: string; deleted_count: number }>(
    `/admin/users/guests`,
    { method: "DELETE" },
  )
}

export function getAllUsers(): Promise<PublicUser[]> {
  return apiRequest<PublicUser[]>("/users")
}

export function sendLogs(
  userId: string,
  username: string,
  version: string,
  logs: string[],
): Promise<{ status: string; message: string; log_id: number }> {
  return apiRequest<{ status: string; message: string; log_id: number }>("/logs", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      username,
      version,
      logs: logs.join("\n"),
    }),
  })
}

export function getLogs(): Promise<DebugLog[]> {
  return apiRequest<DebugLog[]>("/admin/logs")
}

export function getLog(logId: number): Promise<{ log: DebugLog; content: string }> {
  return apiRequest<{ log: DebugLog; content: string }>(`/admin/logs/${logId}`)
}

export function deleteLog(logId: number): Promise<{ status: string; message: string }> {
  return apiRequest<{ status: string; message: string }>(`/admin/logs/${logId}`, {
    method: "DELETE",
  })
}

export function getAudioFiles(): Promise<AudioFile[]> {
  return apiRequest<AudioFile[]>("/audio")
}

export function uploadAudio(
  file: File,
  displayName: string,
): Promise<{ id: string; display_name: string; audio_url: string }> {
  const formData = new FormData()
  formData.append("audio", file)
  formData.append("display_name", displayName)

  const token = getAuthToken()
  return fetch(`${API_BASE}/audio/upload`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  }).then(async (response) => {
    if (!response.ok) {
      if (response.status === 413) {
        throw new Error("File too large. Maximum size is 30MB.")
      }
      const errorText = await response.text()
      throw new Error(errorText || `Upload failed (${response.status})`)
    }
    return response.json()
  })
}

export function deleteAudio(id: string): Promise<void> {
  return apiRequest<void>(`/admin/audio/${id}`, { method: "DELETE" })
}

export function renameAudio(id: string, displayName: string): Promise<void> {
  return apiRequest<void>(`/admin/audio/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  })
}

export function getAudioUrl(id: string): string {
  return `${API_BASE}/audio/${id}`
}

export function enableRoomStats(roomId: string): Promise<{ status: string; message: string }> {
  return apiRequest<{ status: string; message: string }>(`/admin/stats/rooms/${roomId}/enable`, {
    method: "POST",
  })
}

export function disableRoomStats(roomId: string): Promise<{ status: string; message: string }> {
  return apiRequest<{ status: string; message: string }>(`/admin/stats/rooms/${roomId}/disable`, {
    method: "POST",
  })
}

export function subscribeRoomStats(roomId: string): Promise<{ status: string; message: string }> {
  return apiRequest<{ status: string; message: string }>(`/admin/stats/rooms/${roomId}/subscribe`, {
    method: "POST",
  })
}

export function unsubscribeRoomStats(roomId: string): Promise<{ status: string; message: string }> {
  return apiRequest<{ status: string; message: string }>(
    `/admin/stats/rooms/${roomId}/unsubscribe`,
    { method: "POST" },
  )
}

export function getStatsStatus(): Promise<StatsStatus[]> {
  return apiRequest<StatsStatus[]>("/admin/stats/status")
}

export function healthCheck(): Promise<{
  status: string
  service: string
  version: string
}> {
  return apiRequest<{ status: string; service: string; version: string }>("/health")
}
