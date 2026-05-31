import { isElectron } from "@/services/electron"

export function assetPath(path: string): string {
  if (isElectron()) {
    return '.' + path
  }
  return path
}
