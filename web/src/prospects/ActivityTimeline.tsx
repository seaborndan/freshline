import { useState } from 'react'
import type { Activity, SavedProspect } from './model'
import { localToday } from './workspace'
import { formatPlainDate } from '../api/plainDate'
export function ActivityTimeline({ prospect, onSave }: { prospect: SavedProspect; onSave: (activities: Activity[]) => boolean }) {
  const [text, setText] = useState('')
  const [date, setDate] = useState(localToday)
  const [kind, setKind] = useState<Activity['kind']>('Note')
  const [removed, setRemoved] = useState<Activity | null>(null)
  const activities = prospect.activities ?? []
  return <details className="activity-timeline"><summary>Contact timeline ({activities.length})</summary><p>Personal activity log for this list. Logging an email or call does not send anything.</p>
    <form onSubmit={e => { e.preventDefault(); if (!text.trim() || activities.length >= 1000) return; if (onSave([...activities, { id: crypto.randomUUID(), date, kind, text: text.trim() }])) setText('') }}>
      <label>Activity type<select value={kind} onChange={e => setKind(e.target.value as Activity['kind'])}>{['Note', 'Call', 'Visit', 'Email'].map(k => <option key={k}>{k}</option>)}</select></label><label>Activity date<input required type="date" max={localToday()} value={date} onChange={e => setDate(e.target.value)} /></label><label>Activity details<textarea required maxLength={2000} value={text} onChange={e => setText(e.target.value)} /></label><button type="submit" disabled={activities.length >= 1000}>Log activity</button>
    </form><ol>{[...activities].sort((a,b) => b.date.localeCompare(a.date)).map(a => <li key={a.id}><strong>{a.kind} · {formatPlainDate(a.date)}</strong><p>{a.text}</p><button type="button" onClick={() => { if (onSave(activities.filter(row => row.id !== a.id))) setRemoved(a) }}>Remove activity</button></li>)}</ol>
    {removed ? <button type="button" onClick={() => { if (onSave([...activities.filter(a => a.id !== removed.id), removed])) setRemoved(null) }}>Undo activity removal</button> : null}
  </details>
}
