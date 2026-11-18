// `orca plugin test .` lo ejecuta en Node con el mismo runtime y comprobaciones que usa Orca.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { BudgetState } from './protocol'

const usage = { day: '2026-11-18', total: 0.03, limit: 2, month: 3.28, allTime: 3.7 }

test('muestra el gasto y cambia el límite', async () => {
  let answer: BudgetState = { connected: true, usage }
  const host = mockHost({
    requests: {
      'budget.usage': () => answer,
      'budget.setLimit': ({ limit }) => {
        answer = { connected: true, usage: { ...(answer.usage ?? usage), limit } }
        return answer
      }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ type: 'Heading', text: '$0.03 de $2.00' }))
  const kv = view.find({ type: 'KeyValue' })
  const items = (kv?.props.items ?? []) as { label: string; value: unknown }[]
  assert.equal(items.find((item) => item.label === 'Este mes')?.value, '$3.28')

  // Otro panel u otro poll: el worker publica el estado nuevo.
  await view.post('budget.changed', {
    connected: true,
    usage: { ...usage, total: 1.8 }
  })
  assert.ok(view.find({ type: 'Heading', text: '$1.80 de $2.00' }))

  await view.type({ label: 'Límite diario (USD)' }, '5', { replace: true })
  await view.press({ text: 'Guardar' })
  // El worker responde con una lectura fresca de OpenCode (el mock conserva su propio total).
  assert.ok(view.find({ type: 'Heading', text: '$0.03 de $5.00' }))

  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('muestra el error cuando OpenCode no responde', async () => {
  const host = mockHost({
    requests: {
      'budget.usage': { connected: false, error: 'el plugin daily-budget no está cargado en OpenCode' }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: /No pude leer el gasto/ }))
  assert.ok(view.find({ text: /no está cargado en OpenCode/ }))
  await view.unmount()
})
