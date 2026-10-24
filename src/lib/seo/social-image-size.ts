/** Conservative site performance budget, not a universal platform acceptance limit. */
export const SOCIAL_IMAGE_RECOMMENDED_BYTES = 300_000;

export function assessSocialImageSize(
  pathname: string,
  bytes: number,
): { ok: boolean; line: string } {
  const ok = bytes <= SOCIAL_IMAGE_RECOMMENDED_BYTES;
  return {
    ok,
    line: `${ok ? "✓" : "✗"} ${pathname} — ${(bytes / 1000).toFixed(1)} kB (${bytes} bytes) — ${ok ? "within" : "exceeds"} ${SOCIAL_IMAGE_RECOMMENDED_BYTES / 1000} kB preview budget`,
  };
}
