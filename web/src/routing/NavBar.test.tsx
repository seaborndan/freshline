import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NavBar } from './NavBar'

describe('NavBar', () => {
  /**
   * The property that makes these links rather than buttons.
   *
   * A `<button onClick={navigate}>` looks identical and silently loses middle-click, ctrl-click,
   * "copy link address", the status-bar preview, and the screen-reader announcement. Querying by
   * role is what pins it down: `getByRole('link')` fails against a button.
   */
  it('renders navigation as links with real destinations', () => {
    render(<NavBar current="landing" onNavigate={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/map')
    expect(screen.getByRole('link', { name: 'Freshline' })).toHaveAttribute('href', '/')
  })

  it('navigates on an ordinary click without letting the browser follow the link', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()

    render(<NavBar current="landing" onNavigate={onNavigate} />)

    await user.click(screen.getByRole('link', { name: 'Map' }))

    expect(onNavigate).toHaveBeenCalledWith('map')
  })

  /**
   * Ctrl-click means "open this in a new tab", and calling preventDefault on it would swallow the
   * request and navigate the current tab instead — the opposite of what was asked for.
   */
  it('leaves a modified click to the browser', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()

    render(<NavBar current="landing" onNavigate={onNavigate} />)

    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('link', { name: 'Map' }))
    await user.keyboard('{/Control}')

    expect(onNavigate).not.toHaveBeenCalled()
  })

  /**
   * aria-current is the assistive-technology equivalent of the underline. Without it, which page you
   * are on is information available only to people who can see the styling.
   */
  it('marks the current page for a screen reader, not only visually', () => {
    render(<NavBar current="map" onNavigate={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not mark a page that is not current', () => {
    render(<NavBar current="landing" onNavigate={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Map' })).not.toHaveAttribute('aria-current')
  })
})
