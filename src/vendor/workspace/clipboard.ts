/**
 * Clipboard write with a synchronous `execCommand` fallback. The shipped
 * primitives helper returns false when the async Clipboard API rejects, even
 * on insecure contexts where `execCommand('copy')` still works — this helper
 * tries the legacy path first inside the click gesture.
 */

/**
 * Write one text value to the host clipboard.
 * @param text - exact text to place on the clipboard.
 * @returns true only when a clipboard backend accepted the write.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      const accepted = document.execCommand('copy')
      if (accepted) return true
    } catch {
      // Fall through to the async API below.
    } finally {
      textarea.remove()
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }
  return false
}
