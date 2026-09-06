import { useState } from 'react'
import type { InspectionDetail } from '../api/contract'
import { formatPlainDate } from '../api/plainDate'

export function InspectionComparison({ inspections }: { inspections: InspectionDetail[] }) {
  const [comparisonId, setComparisonId] = useState('')
  const latest = inspections[0]
  const earlier = inspections.slice(1)
  const previous = earlier.find(p => String(p.id) === comparisonId) ?? earlier[0]
  if (!latest || !previous) return null
  const latestCodes = new Set(latest.violations.map(v => v.code))
  const previousCodes = new Set(previous.violations.map(v => v.code))
  const groups = [
    { label: 'Only in latest record', items: latest.violations.filter(v => !previousCodes.has(v.code)) },
    { label: 'Cited in both records', items: latest.violations.filter(v => previousCodes.has(v.code)) },
    { label: 'Only in comparison record', items: previous.violations.filter(v => !latestCodes.has(v.code)) },
  ]
  return <section className="inspection-comparison" aria-label="Compare inspection citations">
    <h3>What changed between records?</h3>
    <p>Latest: <strong>{formatPlainDate(latest.inspectedOn)}</strong>{latest.inspectionType ? ` · ${latest.inspectionType}` : ''}</p>
    <label>Compare latest with<select value={previous.id} onChange={e => setComparisonId(e.target.value)}>{earlier.map((p, i) => <option key={p.id} value={p.id}>{formatPlainDate(p.inspectedOn)} · {p.inspectionType || 'Type not published'} · record {i + 2}</option>)}</select></label>
    {latest.inspectedOn === previous.inspectedOn ? <p>These records have the same date; their order within that day is unknown.</p> : null}
    <p>This compares citation codes, not service needs or proof of resolution. Inspection types and scope can differ. “Only in latest” does not mean a condition first began then.</p>
    {groups.map(group => <details key={group.label}><summary>{group.label} ({group.items.length})</summary>{group.items.length ? <ul>{group.items.map(v => <li key={v.code}><strong>{v.code}</strong> {v.description ?? 'No description published.'}</li>)}</ul> : <p>No citation codes in this group.</p>}</details>)}
  </section>
}
