// Ejecuta activate(orca) de src/worker.ts con el objeto que Orca pasa, sobre un host simulado.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

test('lee el gasto por RPC y cambia el límite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'daily-budget-'))
  const serviceFile = join(dir, 'service.json')
  await writeFile(
    serviceFile,
    JSON.stringify({ url: 'http://127.0.0.1:1/', password: 'secret' }),
    'utf8'
  )
  process.env.ORCA_DAILY_BUDGET_SERVICE_FILE = serviceFile

  let limit = 2
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? (JSON.parse(String(init.body)) as { input: unknown }) : { input: {} }
    if (url.endsWith('/api/rpc/daily-budget/usage')) {
      return new Response(
        JSON.stringify({
          output: { day: '2026-11-18', total: 0.03, limit, month: 3.28, allTime: 3.7 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    if (url.endsWith('/api/rpc/daily-budget/setLimit')) {
      limit = (body.input as { limit: number }).limit
      return new Response(JSON.stringify({ output: { limit } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    throw new Error(`fetch inesperado: ${url}`)
  }) as typeof fetch

  const host = mockHost()
  const worker = await mountWorker(main, { host })
  const first = await worker.request('budget.usage')
  assert.deepEqual(first, {
    connected: true,
    usage: { day: '2026-11-18', total: 0.03, limit: 2, month: 3.28, allTime: 3.7 }
  })

  const changed = await worker.request('budget.setLimit', { limit: 4 })
  assert.equal(changed.usage?.limit, 4)
  assert.equal(host.callsOf('statusBar.update').length > 0, true)

  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
  globalThis.fetch = realFetch
  delete process.env.ORCA_DAILY_BUDGET_SERVICE_FILE
})
