/**
 * Which page the address bar is asking for.
 *
 * ## Still no router, and this is where that decision gets re-examined
 *
 * `urlState.ts` says "no router" and gives the reason: there was one page, no route matching, and a
 * router would have been added to wrap two browser APIs. There is more than one page now, so the
 * premise has changed and the conclusion has to be re-argued rather than inherited.
 *
 * It survives, for reasons that are specific rather than ideological:
 *
 * - **A short, flat list of routes, no parameters, no nesting.** Every piece of per-page state — the
 *   viewport, the filters, the selected establishment — already lives in the *query string*, not the
 *   path. A router's main job is turning path segments into values, and
 *   there are no path segments here that carry values.
 * - **It would have to be taught not to fight the existing code.** The map writes the address bar on
 *   every pan with `replaceState`, deliberately, so that panning does not fill the back button with
 *   an undo history. A router owns history; wiring one in means either routing through its API or
 *   having two things write the same address bar, and the second is how a back button starts
 *   behaving differently on one page than another.
 * - **The whole of it is below.** A dependency is a decision under `CLAUDE.md`, and this file is the
 *   honest comparison: a route union, a parser, and a formatter.
 *
 * **What would reverse this:** route parameters that carry state (`/establishment/:id` rather than
 * `?id=`), nested layouts, or code splitting per route. Any of those is a real router's job, and
 * hand-rolling them would be the mistake this file is currently avoiding.
 */

/** Every page in the application. A closed union, so a new page cannot be added by typo. */
export type Route = 'landing' | 'map' | 'reports' | 'prospects' | 'prospect-map'

export const defaultRoute: Route = 'landing'

/**
 * The path each route lives at.
 *
 * `/` for the landing page: it is what a bare domain resolves to, and making the entry point a
 * redirect to `/landing` would put a redirect in front of every first visit for no gain.
 */
const paths: Record<Route, string> = {
  landing: '/',
  map: '/map',
  reports: '/reports',
  prospects: '/prospects',
  'prospect-map': '/prospects/map',
}

/**
 * The route a pathname asks for, falling back to the landing page.
 *
 * **Unknown paths fall back rather than 404.** A wrong path here is nearly always a typed or
 * truncated link, and showing someone the front door is a better answer than an error page — the
 * landing page explains what the site is, which is exactly what a person who mistyped a URL needs.
 *
 * A trailing slash is tolerated because `/map/` and `/map` are the same request as far as anyone
 * typing one is concerned, and static hosts differ on which they serve.
 */
export function routeFromPath(pathname: string): Route {
  const normalised = pathname.replace(/\/+$/, '').toLowerCase()

  if (normalised === '' ) {
    return 'landing'
  }

  const match = (Object.keys(paths) as Route[]).find(
    (route) => paths[route].replace(/\/+$/, '') === normalised,
  )

  return match ?? defaultRoute
}

/** The path a route lives at, for links and for `pushState`. */
export function pathFromRoute(route: Route): string {
  return paths[route]
}
