import { useEffect, useRef, useState } from 'react'
import { fetchEstablishment } from '../api/client'
import type { EstablishmentDetail } from '../api/contract'
import type { SavedProspect } from '../prospects/model'
import { formatPlainDate } from '../api/plainDate'
import { snapshotChanged } from './workflow'

export function ChangesInbox({ saved }: { saved: SavedProspect[] }) {
  const [results, setResults] = useState<{ saved: SavedProspect; detail: EstablishmentDetail }[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function check() {
    const abort = new AbortController(); controller.current = abort; setBusy(true); setResults([])
    const unique = [...new Map(saved.map(p => [p.id, p])).values()]
    const found: { saved: SavedProspect; detail: EstablishmentDetail }[] = []
    try {
      for (let i = 0; i < unique.length; i++) {
        const p = unique[i]; setMessage(`Checking ${i + 1} of ${unique.length} saved restaurants…`)
        const detail = await fetchEstablishment(p.id, abort.signal)
        const snapshots = saved.filter(row => row.id === p.id)
        if (snapshots.some(s => snapshotChanged(s, detail))) found.push({ saved: p, detail })
        setResults([...found])
      }
      setMessage(`Checked ${unique.length} restaurants. ${found.length} differ from at least one saved snapshot.`)
    } catch { setMessage(abort.signal.aborted ? 'Check stopped. Results shown are partial.' : 'Check interrupted by a request failure. Results shown are partial; retry when ready.') }
    finally { setBusy(false) }
  }
  return <section><h2>Changes to saved evidence</h2><p>Compare the current dataset with your saved restaurant snapshots. This detects dates or citation codes that differ, including corrected records. It does not prove when data was imported or that a condition is resolved. Saved evidence stays unchanged.</p><div className="work-actions"><button disabled={busy || !saved.length} onClick={check}>Check saved restaurants</button>{busy ? <button onClick={() => controller.current?.abort()}>Stop checking</button> : null}</div><p role="status">{message}</p>
    <ul className="work-list">{results.map(({ saved: p, detail }) => <li key={p.id}><div><strong>{p.name}</strong><p>Current inspection: {detail.inspections[0] ? formatPlainDate(detail.inspections[0].inspectedOn) : 'No inspection recorded'} · {detail.inspections[0]?.violations.length ?? 0} citations. Saved in {saved.filter(s => s.id === p.id).map(s => s.list).join(', ')}.</p></div><a href={`/map?id=${p.id}&focus=1`}>Review history and compare</a></li>)}</ul>
  </section>
}
