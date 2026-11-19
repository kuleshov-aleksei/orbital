import { Capacitor } from "@capacitor/core"
import { releaseKeyboardImage, type KeyboardImageFile } from "@/services/platform"

/** Gives keyboard-provided content a safe, accurate attachment filename. */
export function keyboardGifName(rawName: string): string {
  const base = Array.from(rawName.split(/[\\/]/).pop() ?? "")
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return code >= 32 && code !== 127 && char !== '"'
    })
    .join("")
    .trim()
  const stem = base.replace(/\.[^.]*$/, "").trim()
  return `${!stem || /^\.+$/.test(stem) ? "keyboard" : stem}.gif`
}

/** Reads a native temporary GIF into the same File shape used by the picker. */
export async function readKeyboardImage(image: KeyboardImageFile): Promise<File> {
  try {
    const response = await fetch(Capacitor.convertFileSrc(image.uri))
    if (!response.ok) throw new Error(`Keyboard image read failed: ${response.status}`)
    const blob = await response.blob()
    if (blob.size !== image.size) throw new Error("Keyboard image was truncated")
    return new File([blob], keyboardGifName(image.name), {
      type: "image/gif",
      lastModified: Date.now(),
    })
  } finally {
    await releaseKeyboardImage(image.uri)
  }
}
