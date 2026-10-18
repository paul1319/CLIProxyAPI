/** Which edges of a horizontally scrolling strip hide content (drives the fade masks). */

export interface ScrollExtent {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

export interface StripOverflow {
  /** Content is hidden past the left edge. */
  start: boolean;
  /** Content is hidden past the right edge. */
  end: boolean;
}

/** Sub-pixel slack so fractional layout widths never leave a fade on a fully visible strip. */
const EDGE_TOLERANCE_PX = 1;

export function readStripOverflow({
  scrollLeft,
  scrollWidth,
  clientWidth,
}: ScrollExtent): StripOverflow {
  const hidden = scrollWidth - clientWidth;
  if (hidden <= EDGE_TOLERANCE_PX) return { start: false, end: false };
  return {
    start: scrollLeft > EDGE_TOLERANCE_PX,
    end: scrollLeft < hidden - EDGE_TOLERANCE_PX,
  };
}
