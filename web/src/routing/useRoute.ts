/**
 * The current page, and how to change it.
 *
 * Two things have to work for this to be navigation rather than a tab switcher: the address bar has
 * to change when the user clicks a link, and the page has to change when the user presses Back. The
 * second is the one that gets forgotten, and `popstate` is the event that provides it.
 */

import { useCallback, useEffect, useState } from 'react'
import { pathFromRoute, routeFromPath, type Route } from './route'

export interface Navigation {
  route: Route
  navigate: (route: Route) => void
}

export function useRoute(): Navigation {
  const [route, setRoute] = useState<Route>(() => routeFromPath(window.location.pathname))

  /**
   * Back and forward.
   *
   * `popstate` fires when the user moves through history, and *not* when the application calls
   * `pushState` itself — which is why `navigate` below sets the state as well as pushing. Without
   * this listener the address bar would go back and the page would not, which is worse than no
   * navigation at all: the URL would describe a page the user is not looking at, and copying it
   * would share the wrong thing.
   */
  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(window.location.pathname))

    window.addEventListener('popstate', onPopState)

    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  /**
   * `pushState` here, unlike everywhere else in this application.
   *
   * The map writes the viewport with `replaceState` on every pan, because a history entry per pan
   * turns Back into an undo-my-panning key. Changing page is the opposite case: it is a deliberate
   * act, the user expects Back to return them, and there is exactly one entry per act.
   *
   * Navigating to the page already showing is ignored, so a second click on the current nav link
   * does not stack a duplicate history entry that Back then has to be pressed twice to escape.
   */
  const navigate = useCallback((next: Route) => {
    if (next === routeFromPath(window.location.pathname)) {
      return
    }

    // The query string is deliberately dropped. Its parameters belong to the page that wrote them —
    // a viewport and a selected establishment mean nothing on the reports page — and carrying them
    // across would leave the address bar describing state the new page neither reads nor owns.
    window.history.pushState(null, '', pathFromRoute(next))
    setRoute(next)
  }, [])

  return { route, navigate }
}
