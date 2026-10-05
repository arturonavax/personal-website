/**
 * Pure scroll state machine for the sticky site header (SPEC-007 REQ-1).
 *
 * Hysteresis: deltas smaller than {@link HEADER_HYSTERESIS_PX} are ignored and do
 * NOT advance `lastY`, so they accumulate until they cross the threshold. This
 * removes jitter-driven class toggling (layout thrash / animation restarts).
 *
 * The caller owns the DOM; this module owns only the decision.
 */

export const HEADER_HYSTERESIS_PX = 16;
export const HEADER_ALWAYS_VISIBLE_Y = 10;
export const HEADER_HIDE_AFTER_Y = 80;

export interface HeaderScrollState {
  hidden: boolean;
  lastY: number;
}

export interface HeaderScrollInput extends HeaderScrollState {
  currentY: number;
  /** True during programmatic scrolls (anchor clicks, back-to-top, etc.). */
  locked: boolean;
}

export function nextHeaderScrollState(
  input: HeaderScrollInput,
): HeaderScrollState {
  const { currentY, lastY, hidden, locked } = input;

  if (locked || currentY <= HEADER_ALWAYS_VISIBLE_Y) {
    return { hidden: false, lastY: currentY };
  }

  const delta = currentY - lastY;
  if (Math.abs(delta) < HEADER_HYSTERESIS_PX) {
    return { hidden, lastY };
  }

  if (delta > 0 && currentY > HEADER_HIDE_AFTER_Y) {
    return { hidden: true, lastY: currentY };
  }
  if (delta < 0) {
    return { hidden: false, lastY: currentY };
  }
  return { hidden, lastY: currentY };
}
