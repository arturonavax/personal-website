/**
 * Universal clipboard copy helper.
 * Works seamlessly across:
 * - Secure Contexts (HTTPS, localhost, 127.0.0.1) via navigator.clipboard.writeText
 * - Non-Secure Contexts (LAN IP http://192.168.x.x, internal dev) via document.execCommand fallback
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try modern navigator.clipboard if available (Secure Context)
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy fallback if writeText fails (e.g. focus or permissions)
    }
  }

  // 2. Fallback via temporary textarea and execCommand('copy') for non-secure contexts
  if (typeof document !== "undefined") {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      // Position off-screen and prevent scrolling or visual flicker
      textArea.style.position = "fixed";
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.width = "2em";
      textArea.style.height = "2em";
      textArea.style.padding = "0";
      textArea.style.border = "none";
      textArea.style.outline = "none";
      textArea.style.boxShadow = "none";
      textArea.style.background = "transparent";
      textArea.style.opacity = "0";
      textArea.setAttribute("readonly", "");
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const doc = document as unknown as {
        execCommand?: (commandId: string) => boolean;
      };
      const successful = Boolean(doc.execCommand?.("copy"));
      document.body.removeChild(textArea);
      return successful;
    } catch {
      return false;
    }
  }

  return false;
}
