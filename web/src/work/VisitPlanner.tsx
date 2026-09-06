import { useState } from 'react'
import type { SavedProspect } from '../prospects/model'
import { localToday } from '../prospects/workspace'
import { readVisitPlan, type VisitPlan } from './workflow'

const key = 'freshline.visit-plan.v1'
export function VisitPlanner({ saved }: { saved: SavedProspect[] }) {
  const [initial] = useState(() => { try { return { plan: readVisitPlan(localStorage.getItem(key)), error: '' } } catch { return { plan: { date: localToday(), ids: [] }, error: 'Visit plan could not be read. Existing data is preserved.' } } })
  const [plan, setPlan] = useState<VisitPlan>(initial.plan)
  const [error, setError] = useState(initial.error)
  const [query, setQuery] = useState('')
  const unique = [...new Map(saved.map(p => [p.id, p])).values()]
  function update(next: VisitPlan) { try { if (initial.error) return; readVisitPlan(JSON.stringify(next)); const current = readVisitPlan(localStorage.getItem(key)); if (JSON.stringify(current) !== JSON.stringify(plan)) { setError('Plan changed in another tab. Reload before editing.'); return } localStorage.setItem(key, JSON.stringify(next)); setPlan(next); setError('') } catch { setError('Could not save visit plan. Use a valid date and unique stops.') } }
  function shift(index: number, delta: number) { const ids = [...plan.ids]; [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; update({ ...plan, ids }) }
  return <section><h2>Plan your visits</h2><p>Choose stops and arrange them manually. Directions open an external maps provider only when clicked; travel times and route optimization are not calculated. Your plan stays in this browser.</p>
    {error ? <p role="alert">{error}</p> : null}<label>Visit date<input type="date" value={plan.date} onChange={e => update({ ...plan, date: e.target.value })} /></label>
    <ol className="visit-stops">{plan.ids.map((id, index) => { const p = unique.find(row => row.id === id); return <li key={id}><strong>{p?.name ?? 'Restaurant no longer saved'}</strong><p>{[p?.address, p?.locality].filter(Boolean).join(', ')}</p><div className="work-actions"><button disabled={index === 0} onClick={() => shift(index, -1)}>Move up<span className="visually-hidden"> stop {index + 1}</span></button><button disabled={index === plan.ids.length - 1} onClick={() => shift(index, 1)}>Move down<span className="visually-hidden"> stop {index + 1}</span></button><button onClick={() => update({ ...plan, ids: plan.ids.filter(value => value !== id) })}>Remove stop<span className="visually-hidden"> {index + 1}</span></button>{p?.address ? <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${p.name}, ${p.address}, ${p.locality ?? ''}, New York City`)}`}>Directions to this stop</a> : <span>Address unavailable</span>}</div></li> })}</ol>
    {!plan.ids.length ? <p>No stops selected yet.</p> : null}<label>Find a saved restaurant<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <ul className="work-list">{unique.filter(p => !plan.ids.includes(p.id) && `${p.name} ${p.address} ${p.locality}`.toLowerCase().includes(query.toLowerCase())).map(p => <li key={p.id}><span>{p.name} · {p.locality}</span><button onClick={() => update({ ...plan, ids: [...plan.ids, p.id] })}>Add stop<span className="visually-hidden"> {p.name}</span></button></li>)}</ul>
  </section>
}
