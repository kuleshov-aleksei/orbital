// Permission bits — keep in sync with backend/internal/permissions/permissions.go.
// All bits are below 2^31 so they are safe as JS numbers.

export const Permission = {
  Administrator: 1 << 0,
  ManageRoles: 1 << 1,
  ManageRooms: 1 << 2,
  ManageAudio: 1 << 3,
  ViewRoom: 1 << 8,
  Connect: 1 << 9,
  Speak: 1 << 10,
  Video: 1 << 11,
  Screenshare: 1 << 12,
  SendMessages: 1 << 13,
  UseSoundboard: 1 << 14,
  KickMembers: 1 << 15,
  MuteMembers: 1 << 16,
  MoveMembers: 1 << 17,
} as const

export type PermissionName = keyof typeof Permission

/** Permissions that can only be granted through roles (never overwrites). */
export const ROLE_ONLY_PERMISSIONS =
  Permission.Administrator | Permission.ManageRoles | Permission.ManageAudio

/** Human-readable labels and grouping for permission editors. */
export const PERMISSION_INFO: Array<{
  key: PermissionName
  label: string
  description: string
  group: "server" | "room" | "voice"
}> = [
  {
    key: "Administrator",
    label: "Administrator",
    description: "Every permission, ignores room overwrites",
    group: "server",
  },
  {
    key: "ManageRoles",
    label: "Manage Roles",
    description: "Create and assign roles below your highest role, edit room permissions",
    group: "server",
  },
  {
    key: "ManageAudio",
    label: "Manage Audio",
    description: "Rename and delete shared audio files",
    group: "server",
  },
  {
    key: "ManageRooms",
    label: "Manage Rooms",
    description: "Create, edit, delete and reorder rooms and categories",
    group: "room",
  },
  {
    key: "ViewRoom",
    label: "View Room",
    description: "See the room and who is in it",
    group: "room",
  },
  {
    key: "SendMessages",
    label: "Send Messages",
    description: "Write in the room chat",
    group: "room",
  },
  {
    key: "KickMembers",
    label: "Kick Members",
    description: "Disconnect lower-ranked members from the room",
    group: "room",
  },
  { key: "Connect", label: "Connect", description: "Join the room", group: "voice" },
  { key: "Speak", label: "Speak", description: "Transmit microphone audio", group: "voice" },
  { key: "Video", label: "Video", description: "Turn on the camera", group: "voice" },
  {
    key: "Screenshare",
    label: "Screen Share",
    description: "Share a screen or window",
    group: "voice",
  },
  {
    key: "UseSoundboard",
    label: "Use Boombox",
    description: "Play music through the boombox",
    group: "voice",
  },
]

export const hasPermission = (perms: number, want: number): boolean => (perms & want) === want

// Types coming FROM the backend use snake_case (see AGENTS.md).
export interface Role {
  id: string
  name: string
  color: string
  position: number
  permissions: number
  deny_permissions: number
  system_key?: "everyone" | "guest"
  created_at: string
}

export interface RolesResponse {
  roles: Role[]
  user_roles: Record<string, string[]>
}

export type OverwriteTargetType = "room" | "category"
export type OverwriteSubjectType = "role" | "user"

export interface PermissionOverwrite {
  target_type: OverwriteTargetType
  target_id: string
  subject_type: OverwriteSubjectType
  subject_id: string
  allow: number
  deny: number
}

export interface MyPermissions {
  is_owner: boolean
  server: number
  rooms: Record<string, number>
  categories: Record<string, number>
  role_ids: string[]
  top_position: number
}
