/** Cross-platform desktop flavor used for file-manager labels and path helpers. */
export type DesktopPlatform = 'macos' | 'windows' | 'linux'

/** Best-effort desktop platform detection from the browser environment. */
export function detectDesktopPlatform(): DesktopPlatform {
  const ua = navigator.userAgent
  const platform = String(navigator.platform ?? '')
  if (/Mac|iPhone|iPad|iPod/.test(platform) || /Macintosh|Mac OS X/.test(ua)) return 'macos'
  if (/Win/.test(platform) || /Windows/.test(ua)) return 'windows'
  return 'linux'
}

/** Choose the platform-specific label for the detected desktop. */
export function desktopLabel(labels: Readonly<Record<DesktopPlatform, string>>): string {
  return labels[detectDesktopPlatform()]
}

/** Trailing path segment (basename), accepting both POSIX and Windows separators. */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** Parent directory path, accepting both POSIX and Windows separators. */
export function dirname(path: string): string {
  let end = path.length
  while (end > 0 && (path[end - 1] === '/' || path[end - 1] === '\\')) end -= 1
  if (end === 0) return path
  const at = Math.max(path.lastIndexOf('/', end - 1), path.lastIndexOf('\\', end - 1))
  if (at === -1) return path.slice(0, end)
  const parent = path.slice(0, at)
  // Keep POSIX and Windows roots: `/foo` -> `/`, `C:\foo` -> `C:\`.
  if (parent === '') return path[0] ?? path
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`
  return parent
}
