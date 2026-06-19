import { apiRequest } from "./client"
import type { LiveKitTokenResponse, TURNConfigResponse } from "./client"
import type { Room, User, CreateRoomData, UpdateRoomData } from "@/types"

export function getRooms(includePreview = false): Promise<Room[]> {
  const endpoint = includePreview ? "/rooms?preview=true" : "/rooms"
  return apiRequest<Room[]>(endpoint)
}

export function getRoom(roomId: string): Promise<Room> {
  return apiRequest<Room>(`/rooms/${roomId}`)
}

export function createRoom(data: CreateRoomData): Promise<Room> {
  return apiRequest<Room>("/rooms", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function updateRoom(roomId: string, data: UpdateRoomData): Promise<Room> {
  return apiRequest<Room>(`/rooms/${roomId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function deleteRoom(roomId: string): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/rooms/${roomId}`, {
    method: "DELETE",
  })
}

export function joinRoom(
  roomId: string,
  userData: { user_id?: string; nickname?: string },
): Promise<User> {
  return apiRequest<User>(`/rooms/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify(userData),
  })
}

export function leaveRoom(roomId: string, userId: string): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/rooms/${roomId}/leave`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  })
}

export function kickUser(roomId: string, userId: string): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/rooms/${roomId}/kick/${userId}`, {
    method: "POST",
  })
}

export function getRoomUsers(roomId: string): Promise<User[]> {
  return apiRequest<User[]>(`/rooms/${roomId}/users`)
}

export function updateRoomOrder(orders: Record<string, number>): Promise<{ status: string }> {
  return apiRequest<{ status: string }>("/rooms/order", {
    method: "PUT",
    body: JSON.stringify({ orders }),
  })
}

export function getLiveKitToken(roomId: string): Promise<LiveKitTokenResponse> {
  return apiRequest<LiveKitTokenResponse>("/livekit/token", {
    method: "POST",
    body: JSON.stringify({ room_id: roomId }),
  })
}

export function getTurnConfig(userId?: string): Promise<TURNConfigResponse> {
  const endpoint = userId ? `/turn-config?user_id=${userId}` : "/turn-config"
  return apiRequest<TURNConfigResponse>(endpoint)
}
