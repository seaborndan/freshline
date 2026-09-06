import type { SavedProspect } from './model'
import { isDue } from './workspace'

// Plain text keeps user notes literal and can be opened offline without a viewer or script.
export function visitBrief(rows: SavedProspect[], list: string, today: string): string {
  return [
    `FRESHLINE — VISIT BRIEF`, `List: ${list}`, `Prepared: ${today}`, `${rows.length} saved places in the current filtered view`,
    '', 'Source: NYC DOHMH via NYC Open Data. Evidence is a saved inspection snapshot, not proof of a current problem or service need.',
    'Notes are your personal records. Check the latest inspection before acting. This brief is not an optimized route.',
    ...rows.flatMap((p, i) => [
      '', `${i + 1}. ${p.name}`, [p.address, p.locality].filter(Boolean).join(', ') || 'Address not published',
      `Phone: ${p.phone || 'Not published'}`, `Status: ${p.stage}`, `Follow-up: ${p.followUpOn || 'Not scheduled'}`,
      `Inspection snapshot: ${p.inspectedOn || 'No inspection recorded'}`, ...p.evidence.map(e => `  ${e.code}: ${e.description || 'No description published'}`),
      `Notes: ${p.notes || 'No notes yet'}`, 'Conversation notes: ________________________________________',
      ...(p.activities ?? []).map(a => `Activity — ${a.date} / ${a.kind}: ${a.text}`),
      'Next step: _________________________________________________',
    ]),
  ].join('\n')
}

export function agendaRows(saved: SavedProspect[], today: string) {
  return saved.filter(p => isDue(p, today)).sort((a, b) =>
    (a.followUpOn ?? '').localeCompare(b.followUpOn ?? '') || a.name.localeCompare(b.name) || a.list.localeCompare(b.list))
}
