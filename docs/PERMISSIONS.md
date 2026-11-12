# Roles & Permissions

Orbital uses a Discord-style permission system. It is enforced on the backend (REST, WebSocket and LiveKit publish grants); the UI only hides what you can't do.

## Roles

- **Owner**: the first non-guest account. Has every permission and can't be kicked or restricted.
- **@everyone**: the base layer for every signed-in user, guests included.
- **Guest**: a system role applied automatically to guest accounts, right above @everyone. By default it denies camera, screen share, uploading soundboard clips and attaching files.
- **Custom roles**: ordered by position, above Guest. Each role sets every permission to allow / inherit / deny. Roles apply from lowest to highest, so a higher role's allow or deny wins. You can only manage, assign or kick members below your highest role, and you can't grant permissions you don't have. A role's color can be used for its members' nicknames.

Upgrading from an older version converts legacy admins to an **Admin** role with their old rights (Manage Rooms, Kick Members, Manage Audio, Manage Soundboard, Upload/Manage Emojis, Manage Messages).

## Permissions

"Role" permissions can be set only on roles. "Role + override" permissions can also be overridden per room or category.

| Permission | Scope | Allows | @everyone default |
|---|---|---|---|
| Administrator | role | Everything; ignores room overrides (owner-only areas like logs excluded) | |
| Manage Roles | role | Create, edit and assign roles below your own; edit room/category permissions | |
| Manage Audio | role | Rename and delete shared (boombox) audio | |
| Upload Sounds | role | Add clips to the soundboard | ✓ (not guests) |
| Manage Soundboard | role | Rename, edit and delete any soundboard clip | |
| Upload Emojis | role | Add custom emojis | |
| Manage Emojis | role | Rename and delete any custom emoji | |
| Manage Rooms | role + override | Create, edit, delete and reorder rooms and categories | |
| View Room | role + override | See the room, its members and their media state | ✓ |
| Connect | role + override | Join a voice room | ✓ |
| Speak | role + override | Publish microphone audio | ✓ |
| Video | role + override | Turn on the camera | ✓ (not guests) |
| Screen Share | role + override | Share a screen or window | ✓ (not guests) |
| Use Boombox | role + override | Play music through the boombox | ✓ |
| Use Soundboard | role + override | Play soundboard clips to the room | ✓ |
| Send Messages | role + override | Write in the in-call chat and in text channels | ✓ |
| Attach Files | role + override | Upload images, audio and video in text channels | ✓ (not guests) |
| Manage Messages | role + override | Delete other members' messages and files, pin messages in text channels | |
| Kick Members | role + override | Disconnect lower-ranked members | |

Speak, Video, Screen Share, Use Boombox and Use Soundboard are enforced through the LiveKit token: the SFU rejects media the user may not publish.

## Room and category overrides

Each category and room can override permissions for a role or a single member: deny / inherit / allow. They are evaluated like Discord: role permissions → `@everyone` override → combined role overrides → member override, with deny applied before allow at each step.

A room is **synced** with its category until you edit its permissions, which copies the category's overrides into the room.

Changes apply live: members who lose *View Room* or *Connect* are disconnected, and media they may no longer publish is stopped.

## For developers

Adding a permission touches the backend bit, a migration for existing roles and the frontend mirror. The checklist is in [AGENTS.md](../AGENTS.md), section "Permissions (RBAC) must be enforced on the backend".
