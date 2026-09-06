/**
 * The shell: site chrome, and which page is inside it.
 *
 * It holds no application state of its own. The map owns its viewport and filters, the reports page
 * owns its parameters, and each writes its own query string — the shell only decides which of them
 * is mounted, so switching pages cannot leave one page's state governing another's.
 *
 * ## Why the map is not unmounted by a `display: none`
 *
 * A tempting optimisation, because MapLibre takes real work to construct and re-creating it on every
 * visit to `/map` is visible. It is not done, and the reason is that a hidden map is a map with zero
 * width: MapLibre reads the container's size when it initialises and on resize, and a canvas
 * initialised at 0×0 comes back wrong when it is shown again. Paying the construction cost is the
 * honest version, and it is the one that cannot produce a subtly broken map.
 */

import { lazy, Suspense } from 'react'
import { LandingPage } from './landing/LandingPage'
import { ProspectsPage } from './prospects/ProspectsPage'
import { ReportsPage } from './reports/ReportsPage'
import { NavBar } from './routing/NavBar'
import { useRoute } from './routing/useRoute'
import { PageBoundary } from './routing/PageBoundary'
import { WorkPage } from './work/WorkPage'
import { DataHealthPage } from './work/DataHealthPage'
import { ResearchPage } from './work/ResearchPage'
import './App.css'
import './experience.css'

// MapLibre and its styles are loaded only when a map route is opened.
const MapPage = lazy(() => import('./map/MapPage').then(module => ({ default: module.MapPage })))
const ProspectMapPage = lazy(() => import('./prospects/ProspectMapPage').then(module => ({ default: module.ProspectMapPage })))

function App() {
  const { route, navigate } = useRoute()

  return (
    <div className="app-shell">
      {/* Before the nav in the DOM, so it is the first thing a keyboard or screen-reader user
          reaches. Without it, every visit to the map means tabbing through the whole navigation
          before arriving at the content — on every page load. */}
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <NavBar current={route} onNavigate={navigate} />

      <div className="app-content" id="content">
        <PageBoundary key={route}>
        <Suspense fallback={<p className="route-loading" role="status">Loading map workspace…</p>}>
        {route === 'landing' ? <LandingPage onNavigate={navigate} /> : null}
        {route === 'work' ? <WorkPage /> : null}
        {route === 'data' ? <DataHealthPage /> : null}
        {route === 'research' ? <ResearchPage /> : null}
        {route === 'prospects' ? <ProspectsPage onNavigate={navigate} /> : null}
        {route === 'prospect-map' ? <ProspectMapPage /> : null}
        {route === 'map' ? <MapPage /> : null}
        {route === 'reports' ? <ReportsPage onNavigate={navigate} /> : null}
        </Suspense>
        </PageBoundary>
      </div>
    </div>
  )
}

export default App
