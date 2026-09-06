import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VisitPlanner } from './VisitPlanner'
import { ChangesInbox } from './ChangesInbox'
import { fetchEstablishment } from '../api/client'
import type { SavedProspect } from '../prospects/model'
import type { EstablishmentDetail } from '../api/contract'
vi.mock('../api/client', () => ({ fetchEstablishment: vi.fn() }))
const p: SavedProspect = { id:1, name:'Cafe', address:'1 Main', locality:'Queens', phone:null, inspectedOn:'2026-07-01', evidence:[{ code:'04L', description:null }], list:'A', stage:'To review', notes:'' }
beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })
it('persists manually ordered stops without duplicating restaurants across lists', async () => {
  render(<VisitPlanner saved={[p,{...p,list:'B'},{...p,id:2,name:'Bakery'}]} />)
  expect(screen.getAllByRole('button',{ name:/Add stop/ })).toHaveLength(2)
  await userEvent.click(screen.getByRole('button',{ name:/Add stop.*Cafe/ }))
  await userEvent.click(screen.getByRole('button',{ name:/Add stop.*Bakery/ }))
  await userEvent.click(screen.getByRole('button',{ name:/Move up.*stop 2/ }))
  expect(JSON.parse(localStorage.getItem('freshline.visit-plan.v1') ?? '{}').ids).toEqual([2,1])
  expect(screen.getAllByRole('link',{ name:'Directions to this stop' })[0]).toHaveAttribute('href',expect.stringContaining('destination=Bakery'))
})
it('preserves corrupt visit plans rather than overwriting them', async () => {
  localStorage.setItem('freshline.visit-plan.v1','broken')
  render(<VisitPlanner saved={[p]} />)
  await userEvent.click(screen.getByRole('button',{ name:/Add stop/ }))
  expect(localStorage.getItem('freshline.visit-plan.v1')).toBe('broken')
  expect(screen.getByRole('alert')).toHaveTextContent('could not be read')
})
it('reports changed evidence once for a restaurant saved in multiple lists', async () => {
  const detail: EstablishmentDetail = { id:1,name:'Cafe',addressLine:null,locality:null,phone:null,cuisine:null,postalCode:null,latitude:null,longitude:null,isAwaitingFirstInspection:false,inspections:[{id:2,inspectedOn:'2026-07-22',inspectionType:null,action:null,rawGrade:null,rawScore:null,outcome:'Good',normalisedSeverity:null,closedByAuthority:false,violations:[]}] }
  vi.mocked(fetchEstablishment).mockResolvedValue(detail)
  render(<ChangesInbox saved={[p,{...p,list:'B'}]} />)
  await userEvent.click(screen.getByRole('button',{name:'Check saved restaurants'}))
  expect(await screen.findByText(/Checked 1 restaurants/)).toBeInTheDocument()
  expect(fetchEstablishment).toHaveBeenCalledTimes(1)
  expect(screen.getAllByRole('link',{name:'Review history and compare'})).toHaveLength(1)
  expect(p.inspectedOn).toBe('2026-07-01')
})
it('labels failed checks as partial rather than claiming nothing changed', async () => {
  vi.mocked(fetchEstablishment).mockRejectedValue(new Error('offline'))
  render(<ChangesInbox saved={[p]} />)
  await userEvent.click(screen.getByRole('button',{name:'Check saved restaurants'}))
  expect(await screen.findByText(/Results shown are partial; retry/)).toBeInTheDocument()
})
