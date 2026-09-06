import { useState } from 'react'
import { useSavedWorkspace } from '../prospects/useSavedWorkspace'
import { isDue, localToday } from '../prospects/workspace'
import { FollowUpAgenda } from '../prospects/FollowUpAgenda'
import { VisitPlanner } from './VisitPlanner'
import { ChangesInbox } from './ChangesInbox'
import { formatPlainDate } from '../api/plainDate'
import { PlanSummary } from './PlanSummary'

export function WorkPage() {
  const { saved, error } = useSavedWorkspace()
  const [tab, setTab] = useState('Today')
  const today = localToday()
  const unique = [...new Map(saved.map(p => [p.id, p])).values()]
  const upcoming = saved.filter(p => p.stage !== 'Not a fit' && p.followUpOn && p.followUpOn > today).sort((a,b) => (a.followUpOn ?? '').localeCompare(b.followUpOn ?? ''))
  return <div className="work-page reports"><header><p className="eyebrow">YOUR WORKSPACE</p><h1>Turn your territory into a working day.</h1><p>Saved restaurants, follow-ups and visits. Personal work stays in this browser.</p></header>{error ? <p role="alert">{error}</p> : null}
    <nav className="work-actions" aria-label="Workspace sections">{['Today', 'Changes', 'Visits', 'Territory'].map(value => <button key={value} aria-pressed={value === tab} onClick={() => setTab(value)}>{value}</button>)}<a href="/data">Data health</a></nav>
    {tab === 'Today' ? <section><h2>Your next actions</h2><div className="work-stats"><div><strong>{unique.length}</strong> saved restaurants</div><div><strong>{saved.filter(p => isDue(p,today)).length}</strong> due follow-ups across lists</div><div><strong>{saved.filter(p => p.stage === 'To review').length}</strong> list entries to review</div></div><FollowUpAgenda saved={saved} today={today} onOpen={p => { location.href = `/prospects?list=${encodeURIComponent(p.list)}` }} /><PlanSummary onOpen={() => setTab('Visits')} /><h3>Upcoming follow-ups</h3><ul className="work-list">{upcoming.slice(0,20).map(p => <li key={JSON.stringify([p.id,p.list])}><span>{p.name} · {p.followUpOn ? formatPlainDate(p.followUpOn) : ''}</span><a href={`/prospects?list=${encodeURIComponent(p.list)}`}>{p.list}</a></li>)}</ul>{!upcoming.length ? <p>No upcoming follow-ups scheduled.</p> : <p>Showing the next {Math.min(20,upcoming.length)} of {upcoming.length} scheduled list entries.</p>}<h3>Recent activity</h3><ul className="work-list">{saved.flatMap(p => (p.activities ?? []).map(a => ({ ...a, name: p.name, list: p.list, restaurantId: p.id }))).sort((a,b) => b.date.localeCompare(a.date)).slice(0,10).map(a => <li key={JSON.stringify([a.restaurantId,a.list,a.id])}><div><strong>{a.kind} · {a.name} · {formatPlainDate(a.date)}</strong><p>{a.text}</p></div></li>)}</ul><a href="/prospects">Open prospect workspace</a></section> : null}
    {tab === 'Changes' ? <ChangesInbox saved={saved} /> : null}
    {tab === 'Visits' ? <VisitPlanner saved={saved} /> : null}
    {tab === 'Territory' ? <section><h2>Your saved territory</h2><p>Coverage of saved restaurants only, not market share or all restaurants in an area. A restaurant in multiple lists is counted once per borough; progress counts memberships.</p><table><thead><tr><th>Borough</th><th>Saved restaurants</th><th>Contacted / follow-up entries</th></tr></thead><tbody>{[...new Set(unique.map(p => p.locality ?? 'Unknown'))].sort().map(borough => <tr key={borough}><th>{borough}</th><td>{unique.filter(p => (p.locality ?? 'Unknown') === borough).length}</td><td>{saved.filter(p => (p.locality ?? 'Unknown') === borough && ['Contacted','Follow up'].includes(p.stage)).length}</td></tr>)}</tbody></table><h3>Recorded cuisine mix</h3><p>Cuisine is available for restaurants saved from the map. Older discovery saves may not include it.</p><ul>{[...new Set(unique.map(p => p.cuisine || 'Not recorded'))].sort().map(cuisine => <li key={cuisine}>{cuisine}: {unique.filter(p => (p.cuisine || 'Not recorded') === cuisine).length}</li>)}</ul></section> : null}
  </div>
}
