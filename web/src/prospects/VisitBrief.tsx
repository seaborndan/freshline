import type { SavedProspect } from './model'
import { formatPlainDate } from '../api/plainDate'
import { visitBrief } from './fieldwork'
import { localToday } from './workspace'

export function VisitBrief({ rows, list }: { rows: SavedProspect[]; list: string }) {
  function download() {
    const url = URL.createObjectURL(new Blob([visitBrief(rows, list, localToday())], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = `freshline-visit-brief-${localToday()}.txt`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="visit-brief"><div><strong>Take your shortlist with you</strong><p>A text brief with notes and dated evidence for all {rows.length} filtered places, including other pages. Prepared {formatPlainDate(localToday())}.</p></div><button type="button" disabled={!rows.length} onClick={download}>Download visit brief</button></div>
}
