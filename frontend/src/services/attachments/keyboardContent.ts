import { Capacitor } from "@capacitor/core"
import { releaseKeyboardImage, type KeyboardImageFile } from "@/services/platform"

const KEYBOARD_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
}

/** Gives keyboard-provided content a safe filename with its actual image extension. */
export function keyboardImageName(rawName: string, mime: string): string {
  const base = Array.from(rawName.split(/[\\/]/).pop() ?? "")
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return code >= 32 && code !== 127 && char !== '"'
    })
    .join("")
    .trim()
  const stem = base.replace(/\.[^.]*$/, "").trim()
  const name = !stem || /^\.+$/.test(stem) ? "keyboard" : stem
  return `${name}.${KEYBOARD_IMAGE_EXTENSIONS[mime] ?? "img"}`
}

/** Reads a native temporary image into the same File shape used by the picker. */
export async function readKeyboardImage(image: KeyboardImageFile): Promise<File> {
  try {
    const response = await fetch(Capacitor.convertFileSrc(image.uri))
    if (!response.ok) throw new Error(`Keyboard image read failed: ${response.status}`)
    const blob = await response.blob()
    if (blob.size !== image.size) throw new Error("Keyboard image was truncated")
    return new File([blob], keyboardImageName(image.name, image.mime), {
      type: image.mime,
      lastModified: Date.now(),
    })
  } finally {
    await releaseKeyboardImage(image.uri)
  }
}
