import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

// A smoke test, deliberately. Its only job at this milestone is to prove the
// test runner, jsdom environment, and jest-dom matchers are actually wired up
// in CI. Real behavioural tests arrive with real behaviour.
describe('App', () => {
  it('renders the application shell', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Freshline' }),
    ).toBeInTheDocument()
  })
})
