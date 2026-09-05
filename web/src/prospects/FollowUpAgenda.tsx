import type { SavedProspect } from './model'
import { agendaRows } from './fieldwork'
import { formatPlainDate } from '../api/plainDate'

export function FollowUpAgenda({ saved, today, onOpen }: { saved: SavedProspect[]; today: string; onOpen: (p: SavedProspect) => void }) {
  const rows = agendaRows(saved, today)
  return <details className="followup-agenda"><summary>Across your lists · {rows.length} due follow-ups</summary>
    <p>Oldest due dates first. Each list keeps its own follow-up; a restaurant may appear more than once. No notifications are sent.</p>
    {rows.length ? <ul>{rows.map(p => <li key={JSON.stringify([p.list, p.id])}><div><strong>{p.name}</strong><span>{p.list} · {p.followUpOn === today ? 'Today' : `Overdue · ${formatPlainDate(p.followUpOn ?? '')}`}</span></div><button type="button" onClick={() => onOpen(p)}>Open saved record{' '}<span className="visually-hidden"> for {p.name} in {p.list}</span></button></li>)}</ul> : <p>No follow-ups are due. Add a date to a saved restaurant to bring it into this agenda when due.</p>}
  </details>
}
