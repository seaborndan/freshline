/**
 * The site's navigation.
 *
 * ## Why these are anchors and not buttons
 *
 * They navigate, so they are links, and being real `<a href>` elements is what makes them behave
 * like links: middle-click and ctrl-click open a new tab, right-click offers "copy link address",
 * the browser shows the destination in the status bar, and a screen reader announces them as links
 * rather than as buttons that do something unstated.
 *
 * A `<button>` with an `onClick` that calls `navigate` looks identical and loses all of that. It is
 * the most common way a hand-rolled navigation ends up worse than a plain HTML one.
 *
 * The click handler calls `preventDefault` only for ordinary left clicks with no modifier held.
 * Anything else — a middle click, ctrl, cmd, shift, or a right click — is left entirely alone so the
 * browser does what the user asked, which is usually "open this somewhere else".
 */

import { pathFromRoute, type Route } from './route'

interface NavLink {
  route: Route
  label: string
}

const links: NavLink[] = [
  { route: 'work', label: 'My day' },
  { route: 'prospects', label: 'Prospects' },
  { route: 'map', label: 'Map' },
  { route: 'reports', label: 'Reports' },
]

export interface NavBarProps {
  current: Route
  onNavigate: (route: Route) => void
}

export function NavBar({ current, onNavigate }: NavBarProps) {
  const handle = (route: Route) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    // Modified clicks belong to the browser. Calling preventDefault on a ctrl-click would swallow
    // "open in new tab" and navigate the current one instead, which is the opposite of the request.
    if (event.defaultPrevented || event.button !== 0) {
      return
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }

    event.preventDefault()
    onNavigate(route)
  }

  return (
    <nav className="nav" aria-label="Main">
      <a className="nav-brand" href={pathFromRoute('landing')} onClick={handle('landing')}>
        Freshline
      </a>

      <ul>
        {links.map((link) => (
          <li key={link.route}>
            <a
              href={pathFromRoute(link.route)}
              onClick={handle(link.route)}
              // The assistive-technology equivalent of the underline below: it names which of these
              // is the page you are on, which the styling alone conveys only to people who can see
              // it.
              aria-current={current === link.route || (current === 'prospect-map' && link.route === 'prospects') ? 'page' : undefined}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
      <span className="nav-context">NYC restaurant inspections</span>
    </nav>
  )
}
