import { useState } from 'react'
import { readVisitPlan } from './workflow'
import { formatPlainDate } from '../api/plainDate'
export function PlanSummary({ onOpen }: { onOpen: () => void }) {
  const [view] = useState(() => { try { return { plan: readVisitPlan(localStorage.getItem('freshline.visit-plan.v1')), error: '' } } catch { return { plan: null, error: 'Your visit plan could not be read.' } } })
  return <section className="plan-summary"><h3>Visit plan</h3>{view.error ? <p>{view.error}</p> : <p>{view.plan?.ids.length ? `${view.plan.ids.length} stops planned for ${formatPlainDate(view.plan.date)}.` : 'No visits planned yet. Choose saved restaurants and arrange your next trip.'}</p>}<button onClick={onOpen}>Open visit planner</button></section>
}
