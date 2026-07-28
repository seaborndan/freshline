import { describe, expect, it } from 'vitest'
import { pathFromRoute, routeFromPath } from './route'

describe('routeFromPath', () => {
  it('reads the routes the nav links to', () => {
    expect(routeFromPath('/')).toBe('landing')
    expect(routeFromPath('/map')).toBe('map')
  })

  // Static hosts disagree about which of these they serve, and a person typing a URL means the same
  // thing by both.
  it('treats a trailing slash as the same page', () => {
    expect(routeFromPath('/map/')).toBe('map')
  })

  it('is not case sensitive', () => {
    expect(routeFromPath('/Map')).toBe('map')
  })

  // A wrong path is almost always a mistyped or truncated link, and the landing page is the one page
  // that explains what the site is — which is exactly what somebody who mistyped a URL needs.
  it('falls back to the landing page rather than failing', () => {
    expect(routeFromPath('/nope')).toBe('landing')
    expect(routeFromPath('/map/extra')).toBe('landing')
  })

  it('round-trips every route through its path', () => {
    for (const route of ['landing', 'map'] as const) {
      expect(routeFromPath(pathFromRoute(route))).toBe(route)
    }
  })
})
