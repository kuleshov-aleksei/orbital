export function assetPath(path: string): string {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return '.' + path
  }
  return path
}
