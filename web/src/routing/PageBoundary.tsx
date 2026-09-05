import { Component, type ReactNode } from 'react'

/** Keeps navigation usable if a route chunk fails to download. Saved work is never cleared. */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <section className="route-loading" role="alert"><h1>This page could not open.</h1><p>Try reloading the page. Your saved lists have not been cleared.</p><button type="button" onClick={() => location.reload()}>Reload page</button></section>
    return this.props.children
  }
}
