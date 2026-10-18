// DOM helpers for the config page layout (the app scrolls inside .content on desktop and the
// document on mobile, so scroll targets are resolved at runtime).

export function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/** Scroll the page back to the top when the element's top edge is above the viewport. */
export function revealTopOf(element: HTMLElement | null) {
  if (!element || element.getBoundingClientRect().top >= 0) return;
  const scroller = scrollParentOf(element);
  if (scroller) scroller.scrollTo({ top: 0 });
  else window.scrollTo({ top: 0 });
}
