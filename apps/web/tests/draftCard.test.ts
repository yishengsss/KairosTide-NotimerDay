/**
 * M2.5 draft card: change, cancel and excuse drafts show the saved state, the scope and an action-named
 * button. The wire mapping keeps the target as `before` so the card never has to guess what changed.
 */
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createApp, h } from 'vue'

import type { components } from '../../../contracts/api.d.ts'
import { draft as fromWire, type Draft } from '../src/api/assistant.ts'
import DraftCard from '../src/assistant/DraftCard.vue'

type DraftDto = components['schemas']['Draft']

const wire = (overrides: Partial<DraftDto> = {}): DraftDto => ({
  draft_id: 'd1', conversation_id: 'c1', status: 'ready', digest: 'x', missing: [], basis_phrase: '组会改到四点',
  anchor_at: '2026-10-12T01:00:00Z', expires_at: '2999-01-01T00:00:00Z', superseded_by: null,
  committed_event_id: null, expired: false, confirmable: true, kind: 'change',
  fields: { title: '组会', timezone: 'Asia/Shanghai', start_at: '2026-10-13T08:00:00Z',
            end_at: '2026-10-13T09:00:00Z', location: '理科楼', recurrence: null },
  target: { occurrence_id: 'o1', event_id: 'e1', original_slot: 'single', scope: 'occurrence', recurring: false,
            occurrence_version: 1, series_version: 1, title: '组会', location: '理科楼',
            start_at: '2026-10-13T06:00:00Z', end_at: '2026-10-13T07:00:00Z' },
  ...overrides,
})

function render(item: Draft): string {
  const host = document.createElement('div')
  createApp({ render: () => h(DraftCard, { draft: item, review: null, busy: false }) }).mount(host)
  return host.textContent ?? ''
}

describe('change drafts', () => {
  it('maps the target as the state before the change', () => {
    const item = fromWire(wire())
    expect(item.kind).toBe('change')
    expect(item.before?.startAt).toBe(Date.parse('2026-10-13T06:00:00Z'))
    expect(item.startAt).toBe(Date.parse('2026-10-13T08:00:00Z'))
    expect(fromWire(wire({ kind: 'create', target: null })).before).toBeNull()
  })

  it('shows only what changed, with an action-named button', () => {
    const text = render(fromWire(wire()))
    expect(text).toContain('修改')
    expect(text).toContain('→')
    expect(text).toContain('确认修改')
    expect(text).not.toContain('地点') // unchanged rows are left out
  })

  it('says whether one instance or the whole series is affected', () => {
    const one = wire({ kind: 'cancel' })
    one.target = { ...one.target!, recurring: true }
    expect(render(fromWire(one))).toContain('只这一次')
    const all = wire({ kind: 'cancel' })
    all.target = { ...all.target!, recurring: true, scope: 'series' }
    const text = render(fromWire(all))
    expect(text).toContain('整个系列')
    expect(text).toContain('确认删除')
  })

  it('names the leave action', () => {
    expect(render(fromWire(wire({ kind: 'excuse' })))).toContain('确认请假')
  })
})
