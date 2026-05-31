import { isElectron } from "@/services/electron"

const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : ""

export function assetPath(path: string): string {
  const separator = path.includes("?") ? "&" : "?"
  const versioned = `${path}${separator}v=${version}`
  if (isElectron()) {
    return "." + versioned
  }
  return versioned
}
