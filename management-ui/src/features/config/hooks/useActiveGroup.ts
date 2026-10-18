import { useEffect, useState } from 'react';
import type { ConfigTabId } from '../constants';
import { scrollParentOf } from '../dom';
import { CONFIG_SECTION_GROUPS, configGroupDomId } from '../groups';

/**
 * Scroll spy for the section index: the group of the active section whose heading most recently
 * crossed the top band of the viewport. At the bottom of a scrolled page the last group wins.
 */
export function useActiveGroup(sectionId: ConfigTabId, enabled: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const groups = CONFIG_SECTION_GROUPS[sectionId];
    if (!enabled || groups.length === 0) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const threshold = Math.min(160, window.innerHeight * 0.3);
      let current: string | null = groups[0].id;
      let scroller: HTMLElement | null = null;
      for (const group of groups) {
        const element = document.getElementById(configGroupDomId(group.id));
        if (!element) continue;
        scroller ??= scrollParentOf(element);
        if (element.getBoundingClientRect().top <= threshold) current = group.id;
      }
      const scrollTop = scroller ? scroller.scrollTop : window.scrollY;
      const atBottom = scroller
        ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
        : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (scrollTop > 0 && atBottom) current = groups[groups.length - 1].id;
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    schedule();
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    };
  }, [enabled, sectionId]);

  return active;
}
