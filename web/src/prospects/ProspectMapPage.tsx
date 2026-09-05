import { useEffect, useState } from 'react'
import { fetchProspectMap } from '../api/client'
import type { MapEstablishment } from '../api/contract'
import { DetailPanel } from '../detail/DetailPanel'
import { useEstablishmentDetail } from '../detail/useEstablishmentDetail'
import { ResultsList } from '../list/ResultsList'
import { MapView } from '../map/MapView'
import { Legend } from '../map/Legend'
import { readSaved, storageKey } from './model'

export function ProspectMapPage() {
  const [list] = useState(() => new URLSearchParams(location.search).get('list') ?? '')
  const [pins, setPins] = useState<MapEstablishment[] | null>(null)
  const [total, setTotal] = useState(0)
  const [failure, setFailure] = useState('')
  const [candidates, setCandidates] = useState<number[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [focus, setFocus] = useState<{ latitude: number; longitude: number; token: number } | null>(null)
  const detail = useEstablishmentDetail(selected)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const ids = [...new Set(readSaved(localStorage.getItem(storageKey)).filter(p => p.list === list).map(p => p.id))]
      setTotal(ids.length)
      const result = await fetchProspectMap(ids, controller.signal)
      if (!controller.signal.aborted) setPins(result.items)
    }
    load().catch(() => { if (!controller.signal.aborted) setFailure('Could not load this list’s map. Check your connection and reload to retry.') })
    return () => controller.abort()
  }, [list])
  const pin = pins?.find(p => p.id === selected)
  const selection = pin ? { latitude: pin.latitude, longitude: pin.longitude, state: pin.latestInspection?.outcome ?? 'NeverInspected' as const } : null
  function centre() {
    if (pin) setFocus(previous => ({ latitude: pin.latitude, longitude: pin.longitude, token: (previous?.token ?? 0) + 1 }))
  }
  return <div className="map-page">
    <header className="map-status-bar"><div className="explorer-title"><span className="eyebrow">SAVED LIST / MAP</span><h1>{list || 'Saved list'}</h1><a href={`/prospects?list=${encodeURIComponent(list)}`}>Back to saved list</a></div>
      <p role="status">{failure || (pins === null ? 'Loading saved places…' : `${pins.length} of ${total} saved places mapped. ${total - pins.length} unavailable or without coordinates.`)}</p>
    </header>
    <p className="prospect-count">This list belongs to this browser. Pins show current recorded inspection outcomes; saved evidence remains a snapshot.</p>
    {pins !== null && pins.length === 0 ? <p>No places to map. Save restaurants to this list, or check their published addresses.</p> : null}
    {pins && pins.length > 0 ? <main>
      <MapView prominentPins establishments={pins} initialViewport={{
        minLatitude: Math.min(...pins.map(p => p.latitude)) - 0.002,
        maxLatitude: Math.max(...pins.map(p => p.latitude)) + 0.002,
        minLongitude: Math.min(...pins.map(p => p.longitude)) - 0.002,
        maxLongitude: Math.max(...pins.map(p => p.longitude)) + 0.002,
      }} onSelect={ids => { setCandidates(ids); setSelected(ids.length === 1 ? ids[0] : null) }} selection={selection} focusOn={focus} onRecentre={centre} />
      <div className="panels"><ResultsList scope="list" establishments={pins} isTruncated={false} selectedId={selected} onSelect={id => {
        setCandidates([id]); setSelected(id)
        const target = pins.find(p => p.id === id)
        if (target) setFocus(previous => ({ latitude: target.latitude, longitude: target.longitude, token: (previous?.token ?? 0) + 1 }))
      }} /></div>
      <details className="map-key"><summary>Map key</summary><Legend /></details>
      <DetailPanel candidates={pins.filter(p => candidates.includes(p.id))} view={detail} selectedId={selected} onSelect={setSelected} onCentre={centre} onClose={() => { setCandidates([]); setSelected(null) }} />
    </main> : null}
  </div>
}
