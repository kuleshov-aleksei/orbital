import log from "electron-log"
import { getMainWindow } from "../state"
import { getConfig, setHotkeys as persistHotkeys } from "./config"

// KGlobalAccel over D-Bus. Electron's globalShortcut on Wayland goes through
// the xdg-desktop-portal GlobalShortcuts portal, and on KDE/Plasma the portal
// session dies with the app: relaunching leaves kglobalacceld holding stale
// bindings that the portal never re-grabs, so hotkeys silently stop working.
// Registering directly with kglobalacceld from a connection we own sidesteps
// the portal entirely — every launch re-registers and re-arms the grabs.
//
// Reference: kglobalacceld (org.kde.kglobalaccel on the session bus).
//   /kglobalaccel  org.kde.KGlobalAccel          doRegister, setShortcutKeys,
//                                                 getComponent, setInactive,
//                                                 signal: yourShortcutsChanged
//   /component/*   org.kde.kglobalaccel.Component signal: globalShortcutPressed

const SERVICE = "org.kde.kglobalaccel"
const OBJECT = "/kglobalaccel"
const IFACE = "org.kde.KGlobalAccel"
const COMPONENT_IFACE = "org.kde.kglobalaccel.Component"

// Registered component. Must be unique per app; the daemon sanitizes
// non-alphanumeric characters into '_' for the object path.
const COMPONENT_UNIQUE = "com.orbital.app"
const COMPONENT_FRIENDLY = "Orbital"

const ACTIONS = ["mute", "deafen", "ptt"] as const
type HotkeyAction = (typeof ACTIONS)[number]

const ACTION_FRIENDLY: Record<HotkeyAction, string> = {
  mute: "Mute / Unmute",
  deafen: "Deafen / Undeafen",
  ptt: "Push to Talk",
}

const ACTION_EVENT: Record<HotkeyAction, string> = {
  mute: "mute",
  deafen: "deafen",
  ptt: "ptt-pressed",
}

// SetShortcutFlag (kglobalacceld): IsDefault=8, SetPresent=2, NoAutoloading=4.
const FLAG_FORCE = 2 | 4 // SetPresent|NoAutoloading — apply our keys, mark active, persist
const FLAG_AUTOLOAD = 2 // SetPresent — honor whatever the daemon has saved (KDE settings edits)

// Qt::Modifier bits (qnamespace.h)
const MOD_SHIFT = 0x02000000
const MOD_CONTROL = 0x04000000
const MOD_ALT = 0x08000000
const MOD_META = 0x10000000
const MOD_KEYPAD = 0x20000000
const MOD_MASK = MOD_SHIFT | MOD_CONTROL | MOD_ALT | MOD_META | MOD_KEYPAD

// Qt::Key codes used by KGlobalAccel shortcuts
const KEY_F1 = 0xffb1
const QT_KEYS: Record<string, number> = {
  Escape: 0x01000000,
  Tab: 0x01000001,
  Backspace: 0x01000003,
  Enter: 0x01000004,
  Return: 0x01000004,
  Delete: 0x01000007,
  Home: 0xff50,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
  Insert: 0xff63,
  Space: 0x20,
  Plus: 0x2b,
  Minus: 0x2d,
}

const KEYPAD_KEYS: Record<string, number> = {
  numadd: 0x2b,
  numsub: 0x2d,
  nummult: 0x2a,
  numdiv: 0x2f,
  numdec: 0x2e,
}

const QT_KEY_NAMES: Record<number, string> = {
  [0x01000000]: "Escape",
  [0x01000001]: "Tab",
  [0x01000003]: "Backspace",
  [0x01000004]: "Enter",
  [0x01000007]: "Delete",
  [0xff50]: "Home",
  [0xff51]: "Left",
  [0xff52]: "Up",
  [0xff53]: "Right",
  [0xff54]: "Down",
  [0xff55]: "PageUp",
  [0xff56]: "PageDown",
  [0xff57]: "End",
  [0xff63]: "Insert",
  [0x20]: "Space",
  [0x2b]: "Plus",
  [0x2d]: "Minus",
}

interface DbusModule {
  sessionBus: (opts?: unknown) => unknown
}

let bus: any = null
let globalAccelIface: any = null
let componentIface: any = null
let registeredActions = new Set<HotkeyAction>()
let initPromise: Promise<boolean> | null = null

function loadDbus(): DbusModule | null {
  try {
    // Lazy on purpose: bundled as external, only installed (and packaged) on
    // Linux. Never import at module top level.
    return require("dbus-native")
  } catch (e) {
    log.warn("[Hotkey] dbus-native unavailable:", e)
    return null
  }
}

function callGlobalAccel(member: string, signature: string, body: unknown[]): Promise<unknown> {
  return bus.invoke({
    destination: SERVICE,
    path: OBJECT,
    interface: IFACE,
    member,
    signature,
    body,
  }, { timeout: 5000 })
}

function actionIdFor(action: HotkeyAction): string[] {
  return [COMPONENT_UNIQUE, action, COMPONENT_FRIENDLY, ACTION_FRIENDLY[action]]
}

function emitTriggered(action: HotkeyAction): void {
  log.info(`[Hotkey] ${action} triggered via kglobalaccel`)
  getMainWindow()?.webContents.send("hotkey-triggered", ACTION_EVENT[action])
}

// -- Accelerator conversion (Electron format <-> Qt keycode) --

function parseModifiers(tokens: string[]): number {
  let mods = 0
  for (const token of tokens) {
    switch (token) {
      case "Control":
      case "Ctrl":
      case "CommandOrControl":
      case "CmdOrCtrl":
        mods |= MOD_CONTROL
        break
      case "Command":
      case "Cmd":
      case "Meta":
      case "Super":
        // On Linux, Electron's Command is the Super key, i.e. Qt Meta.
        mods |= MOD_META
        break
      case "Alt":
      case "Option":
      case "AltGr":
        mods |= MOD_ALT
        break
      case "Shift":
        mods |= MOD_SHIFT
        break
    }
  }
  return mods
}

function parseKey(token: string): number | null {
  if (QT_KEYS[token] !== undefined) return QT_KEYS[token]
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(token)) {
    return KEY_F1 + parseInt(token.slice(1), 10) - 1
  }
  if (/^[A-Za-z0-9]$/.test(token)) return token.toUpperCase().charCodeAt(0)
  if (/^Key[A-Z]$/.test(token)) return token.charCodeAt(3)
  // HotkeyInput emits e.code, so digits arrive as "Digit1".
  if (/^Digit(\d)$/.test(token)) return 0x30 + parseInt(token.slice(5), 10)
  if (/^Arrow(Up|Down|Left|Right)$/.test(token)) return QT_KEYS[token.slice(5)] ?? null
  if (/^num(\d)$/.test(token)) return MOD_KEYPAD | (0x30 + parseInt(token.slice(3), 10))
  if (KEYPAD_KEYS[token] !== undefined) return MOD_KEYPAD | KEYPAD_KEYS[token]
  return null
}

export function acceleratorToKeycode(accelerator: string): number | null {
  const tokens = accelerator.split("+").map((t) => t.trim()).filter(Boolean)
  if (tokens.length === 0) return null
  const keyToken = tokens[tokens.length - 1]
  const key = parseKey(keyToken)
  if (key === null) return null
  return parseModifiers(tokens) | key
}

function keyNameFromQt(key: number): string | null {
  if (key >= KEY_F1 && key <= 0xffd3) return `F${key - KEY_F1 + 1}`
  const named = QT_KEY_NAMES[key]
  if (named !== undefined) return named
  if (key >= 0x20 && key <= 0x7e) return String.fromCharCode(key)
  return null
}

export function keycodeToAccelerator(keycode: number): string | null {
  if (keycode & MOD_KEYPAD) return null // app UI has no numpad capture
  const key = keycode & 0x01ffffff
  const parts: string[] = []
  if (keycode & MOD_CONTROL) parts.push("CommandOrControl")
  if (keycode & MOD_SHIFT) parts.push("Shift")
  if (keycode & MOD_ALT) parts.push("Alt")
  if (keycode & MOD_META) parts.push("Meta")
  const keyName = keyNameFromQt(key)
  if (keyName === null) return null
  parts.push(keyName)
  return parts.join("+")
}

// -- Sync-back: keep app config in step with what kglobalacceld actually holds --

function firstKeycode(returnedKeys: unknown): number | null {
  // a(ai) comes back as [ [ [ints] ] ] — one struct per shortcut, each struct
  // holding the alternative-shortcut int list.
  const shortcuts = Array.isArray(returnedKeys) ? returnedKeys : null
  const keys = shortcuts && Array.isArray(shortcuts[0]) && Array.isArray(shortcuts[0][0]) ? shortcuts[0][0] : null
  if (!Array.isArray(keys)) return null
  return (keys.find((k) => typeof k === "number" && k !== 0) as number | undefined) ?? null
}

function persistAction(action: HotkeyAction, patch: Partial<{ enabled: boolean; accelerator: string }>): void {
  const current = getConfig().hotkeys[action]
  const hotkeys = getConfig().hotkeys
  persistHotkeys({ ...hotkeys, [action]: { ...current, ...patch } })
}

function syncBack(action: HotkeyAction, returnedKeys: unknown): void {
  const current = getConfig().hotkeys[action]
  const keycode = firstKeycode(returnedKeys)
  if (keycode === null) {
    // The daemon holds no binding (e.g. cleared in KDE System Settings while
    // the app was closed). Respect that instead of re-arming stale config.
    if (current.enabled) {
      log.info(`[Hotkey] kglobalaccel holds no binding for ${action}, disabling in config`)
      persistAction(action, { enabled: false })
    }
    return
  }
  const accelerator = keycodeToAccelerator(keycode)
  if (!accelerator) return
  if (accelerator === current.accelerator) return
  log.info(`[Hotkey] kglobalaccel holds ${action} as ${accelerator}, syncing config`)
  persistAction(action, { accelerator, enabled: true })
}

function onYourShortcutsChanged(...args: unknown[]): void {
  const actionId = args[0] as string[] | undefined
  const keys = args[1] as unknown[] | undefined
  const component = actionId?.[0]
  const action = actionId?.[1] as HotkeyAction | undefined
  if (component !== COMPONENT_UNIQUE || !action || !ACTIONS.includes(action)) return

  const keycode = firstKeycode(keys)
  const current = getConfig().hotkeys[action]
  if (keycode === null) {
    // Cleared in KDE System Settings.
    if (current.enabled) {
      log.info(`[Hotkey] ${action} disabled from KDE settings`)
      persistAction(action, { enabled: false })
    }
    return
  }
  const accelerator = keycodeToAccelerator(keycode)
  if (!accelerator) return
  if (accelerator !== current.accelerator || !current.enabled) {
    log.info(`[Hotkey] ${action} changed from KDE settings: ${accelerator}`)
    persistAction(action, { accelerator, enabled: true })
    // Re-grab in case the action was disabled on our side (isPresent false).
    if (!current.enabled) {
      void reapplyAction(action)
    }
  }
}

function onGlobalShortcutPressed(...args: unknown[]): void {
  const component = args[0] as string
  const action = args[1] as HotkeyAction
  if (component !== COMPONENT_UNIQUE || !ACTIONS.includes(action)) return
  emitTriggered(action)
}

// -- Registration --

async function subscribeToComponent(): Promise<void> {
  if (componentIface || !bus) return
  let path: unknown
  try {
    path = await callGlobalAccel("getComponent", "s", [COMPONENT_UNIQUE])
  } catch (e) {
    log.warn("[Hotkey] getComponent failed:", e)
    return
  }
  try {
    const obj = await bus.getService(SERVICE).getObject(path)
    componentIface = obj.as(COMPONENT_IFACE)
    componentIface.on("globalShortcutPressed", onGlobalShortcutPressed)
  } catch (e) {
    log.warn("[Hotkey] Failed to subscribe to component signals:", e)
  }
}

async function setKeys(action: HotkeyAction, keycode: number | null, flags: number): Promise<unknown> {
  const actionId = actionIdFor(action)
  await callGlobalAccel("doRegister", "as", [actionId])
  // a(ai): array of structs, each struct holding the alternative-shortcut int
  // list — dbus-native spells a struct as an array of its members.
  //
  // The inner array MUST be exactly 4 ints: [key, 0, 0, 0]. KDE's
  // QKeySequence DBus demarshaller reads 4 slots unconditionally (KDE bug
  // 524700) — a shorter array aborts kwin_wayland on Wayland, taking the
  // whole session down. Shortcuts are cleared with the canonical all-zero
  // form, same as KDE's own tooling.
  return callGlobalAccel("setShortcutKeys", "asa(ai)u", [
    actionId,
    keycode === null ? [[[0, 0, 0, 0]]] : [[[keycode, 0, 0, 0]]],
    flags,
  ])
}

async function reapplyAction(action: HotkeyAction): Promise<void> {
  const setting = getConfig().hotkeys[action]
  const keycode = setting.enabled ? acceleratorToKeycode(setting.accelerator) : null
  if (setting.enabled && keycode === null) return
  try {
    await setKeys(action, keycode, FLAG_FORCE)
    if (keycode !== null) {
      registeredActions.add(action)
      await subscribeToComponent()
    } else {
      registeredActions.delete(action)
    }
  } catch (e) {
    log.error(`[Hotkey] Failed to re-register ${action}:`, e)
  }
}

async function registerActions(flags: number, sync: boolean): Promise<void> {
  const hotkeys = getConfig().hotkeys
  for (const action of ACTIONS) {
    const setting = hotkeys[action]
    const keycode = setting.enabled ? acceleratorToKeycode(setting.accelerator) : null
    if (setting.enabled && keycode === null) {
      log.warn(`[Hotkey] Unsupported accelerator for ${action}: ${setting.accelerator}`)
    }
    try {
      // Disabled/unsupported actions must force-empty their keys: the
      // autoload path would otherwise re-arm whatever the daemon last saved.
      const returned = await setKeys(action, keycode, keycode === null ? FLAG_FORCE : flags)
      if (keycode !== null) {
        registeredActions.add(action)
        if (sync) syncBack(action, returned)
      } else {
        registeredActions.delete(action)
      }
    } catch (e) {
      log.error(`[Hotkey] Failed to register ${action}:`, e)
      registeredActions.delete(action)
    }
  }
}

// -- Public API --

export function initKdeHotkeys(): Promise<boolean> {
  if (initPromise) return initPromise
  initPromise = doInit().catch((e) => {
    log.warn("[Hotkey] KGlobalAccel init failed:", e)
    closeKdeHotkeys()
    return false
  })
  return initPromise
}

async function doInit(): Promise<boolean> {
  if (process.platform !== "linux") return false
  const dbus = loadDbus()
  if (!dbus) return false

  bus = dbus.sessionBus()
  bus.connection?.on?.("handlerError", (err: unknown) => log.warn("[Hotkey] DBus handler error:", err))
  bus.connection?.on?.("error", (err: unknown) => log.warn("[Hotkey] DBus connection error:", err))

  let hasOwner = false
  try {
    hasOwner = await bus.invoke({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus",
      member: "NameHasOwner",
      signature: "s",
      body: [SERVICE],
    }, { timeout: 5000 })
  } catch (e) {
    log.warn("[Hotkey] DBus session bus unavailable:", e)
    closeKdeHotkeys()
    return false
  }

  if (!hasOwner) {
    const desktop = process.env.XDG_CURRENT_DESKTOP ?? ""
    if (!/kde|plasma/i.test(desktop)) {
      log.info("[Hotkey] kglobalaccel not present; falling back to Electron globalShortcut")
      closeKdeHotkeys()
      return false
    }
    try {
      await bus.invoke({
        destination: "org.freedesktop.DBus",
        path: "/org/freedesktop/DBus",
        interface: "org.freedesktop.DBus",
        member: "StartServiceByName",
        signature: "ssu",
        body: [SERVICE, 0, 0],
      }, { timeout: 5000 })
    } catch (e) {
      log.warn("[Hotkey] Failed to start kglobalacceld:", e)
      closeKdeHotkeys()
      return false
    }
  }

  // Subscribe before registering so no KDE System Settings edit slips through.
  try {
    const obj = await bus.getService(SERVICE).getObject(OBJECT)
    globalAccelIface = obj.as(IFACE)
    globalAccelIface.on("yourShortcutsChanged", onYourShortcutsChanged)
  } catch (e) {
    log.warn("[Hotkey] Failed to subscribe to yourShortcutsChanged:", e)
  }

  await registerActions(FLAG_AUTOLOAD, true)

  if (registeredActions.size > 0) {
    await subscribeToComponent()
  }

  log.info(`[Hotkey] KGlobalAccel backend active (${[...registeredActions].join(", ") || "no actions"})`)
  return true
}

export async function registerKdeHotkeys(): Promise<void> {
  if (!bus) return
  await registerActions(FLAG_FORCE, false)
  if (registeredActions.size > 0) {
    await subscribeToComponent()
  }
}

export async function unregisterKdeHotkeys(): Promise<void> {
  if (!bus) return
  for (const action of [...registeredActions]) {
    try {
      await callGlobalAccel("setInactive", "as", [actionIdFor(action)])
    } catch (e) {
      log.warn(`[Hotkey] Failed to deactivate ${action}:`, e)
    }
    registeredActions.delete(action)
  }
}

export function closeKdeHotkeys(): void {
  if (!bus) return
  // Best effort: fire setInactive and let the socket flush before closing, so
  // kglobalacceld releases the grabs instead of holding stale bindings.
  for (const action of [...registeredActions]) {
    try {
      bus.invoke({
        destination: SERVICE,
        path: OBJECT,
        interface: IFACE,
        member: "setInactive",
        signature: "as",
        body: [actionIdFor(action)],
      })
    } catch (e) {
      log.warn(`[Hotkey] Failed to deactivate ${action}:`, e)
    }
  }
  registeredActions.clear()
  try {
    bus.close()
  } catch (e) {
    log.warn("[Hotkey] Failed to close DBus connection:", e)
  }
  bus = null
  globalAccelIface = null
  componentIface = null
  initPromise = null
}