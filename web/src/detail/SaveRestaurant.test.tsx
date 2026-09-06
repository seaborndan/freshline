import { beforeEach, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SaveRestaurant } from './SaveRestaurant'
import { readSaved, storageKey } from '../prospects/model'
import type { EstablishmentDetail } from '../api/contract'
const detail: EstablishmentDetail = { id: 1, name: 'Cafe', addressLine: '1 Main', locality: 'Queens', phone: null, cuisine: 'Cafe', postalCode: null, latitude: null, longitude: null, isAwaitingFirstInspection: true, inspections: [] }
beforeEach(() => localStorage.clear())
it('saves a never-inspected restaurant without fabricating evidence or a date', async () => {
  render(<SaveRestaurant detail={detail} />)
  await userEvent.click(screen.getByRole('button', { name: 'Save restaurant to list' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Destination list' }), 'Coffee route')
  await userEvent.click(screen.getByRole('button', { name: 'Save restaurant' }))
  expect(readSaved(localStorage.getItem(storageKey))[0]).toMatchObject({ source: 'map', inspectedOn: '', evidence: [], cuisine: 'Cafe', list: 'Coffee route' })
})
