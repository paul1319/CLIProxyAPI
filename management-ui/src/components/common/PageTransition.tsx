import { ReactNode, RefObject, useLayoutEffect } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import {
  PAGE_TRANSITION_LAYER_CONTEXT_VALUES,
  PageTransitionLayerContext,
} from './PageTransitionLayer';
import './PageTransition.scss';

interface PageTransitionProps {
  render: (location: Location) => ReactNode;
  scrollContainerRef?: RefObject<HTMLElement | null>;
}

/**
 * Renders the current route with a short opacity fade keyed by pathname.
 *
 * Route changes are frequent in a console, so there is no directional choreography and the
 * previous page is unmounted immediately. The live location is always rendered, which keeps
 * typed URLs, bookmarks and back/forward between router-less history entries in sync with the
 * sidebar (hash history gives all of those the same "default" key).
 */
export function PageTransition({ render, scrollContainerRef }: PageTransitionProps) {
  const location = useLocation();

  useLayoutEffect(() => {
    const container = scrollContainerRef?.current;
    container?.scrollTo(0, 0);
  }, [location.pathname, scrollContainerRef]);

  return (
    <div className="page-transition">
      <div key={location.pathname} className="page-transition__layer">
        <PageTransitionLayerContext.Provider value={PAGE_TRANSITION_LAYER_CONTEXT_VALUES.current}>
          {render(location)}
        </PageTransitionLayerContext.Provider>
      </div>
    </div>
  );
}
