/**
 * The shell: which page is showing, and whether the address bar and the page agree.
 *
 * The map itself is tested in `map/MapPage.test.tsx`. What matters here is only that navigating
 * changes both the URL and the content, and that the browser's own Back button is not left behind —
 * which is the part a hand-rolled router most easily gets wrong.
 */

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// The map is mocked out entirely. This file is about routing, and MapLibre in jsdom is a large,
// slow, WebGL-shaped distraction from that.
vi.mock('./map/MapPage', () => ({ MapPage: () => <div>map page</div> }))

vi.mock('./api/client', () => ({
  fetchDatasetSummary: () =>
    Promise.resolve({
      establishmentCount: 1,
      awaitingFirstInspectionCount: 0,
      inspectionCount: 1,
      localityCount: 1,
      cuisineCount: 1,
      latestInspectionOn: '2026-06-01',
    }),
}))

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('App', () => {
  it('opens on the landing page at the root', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: /New York City restaurant inspections/i }),
    ).toBeInTheDocument()
  })

  it('opens directly on the map when the URL asks for it', () => {
    window.history.replaceState(null, '', '/map')

    render(<App />)

    expect(screen.getByText('map page')).toBeInTheDocument()
  })

  it('changes the page and the address bar together', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(screen.getByRole('link', { name: 'Map' }))

    expect(screen.getByText('map page')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/map')
  })

  /**
   * The half that is easy to forget. `popstate` fires when the user goes back, and *not* when the
   * application pushes — so without a listener the URL would return to `/` while the map stayed on
   * screen, leaving the address bar describing a page nobody is looking at.
   *
   * **The event is dispatched rather than driven through `history.back()`, and that is a real limit
   * of this test.** jsdom shares one `window.history` across every test in the file, so by this point
   * the stack holds entries the earlier tests pushed; `back()` walks into them and jsdom gives up
   * with "Not implemented: navigation to another Document". What is left still has teeth — deleting
   * the `popstate` listener from `useRoute` fails this test, which was checked rather than assumed —
   * but it verifies the handler, not the browser.
   */
  it('follows the address bar when history moves', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(screen.getByRole('link', { name: 'Map' }))
    expect(screen.getByText('map page')).toBeInTheDocument()

    await act(async () => {
      window.history.replaceState(null, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(screen.queryByText('map page')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /New York City restaurant inspections/i }),
    ).toBeInTheDocument()
  })

  /**
   * Clicking the page you are already on must not stack a duplicate history entry, or Back has to be
   * pressed twice to leave a page the user only appeared to arrive at once.
   */
  it('does not add a history entry for the page already showing', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(screen.getByRole('link', { name: 'Map' }))
    const afterFirst = window.history.length

    await user.click(screen.getByRole('link', { name: 'Map' }))

    expect(window.history.length).toBe(afterFirst)
  })

  /** Reached before the navigation, so a keyboard user is not made to tab past it on every load. */
  it('offers a skip link ahead of the navigation', () => {
    render(<App />)

    const skip = screen.getByRole('link', { name: /skip to content/i })
    const firstNavLink = screen.getByRole('link', { name: 'Map' })

    expect(skip.compareDocumentPosition(firstNavLink)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})
