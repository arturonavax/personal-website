/** A circular reveal expressed as a rounded inset, without scaling page content. */
export function circularThemeClip(
  x: number,
  y: number,
  width: number,
  height: number,
): [string, string] {
  const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
  const inset = (r: number) =>
    `inset(${y - r}px ${width - x - r}px ${height - y - r}px ${x - r}px round ${r}px)`;
  // At every interpolated radius this is a square of side 2r, rounded by r:
  // a circle centered on the interaction point, including negative insets.
  return [inset(0), inset(radius)];
}
