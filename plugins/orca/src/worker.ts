// Worker del plugin: lee el gasto del plugin `daily-budget` de OpenCode por su RPC HTTP
// (`/api/rpc/daily-budget/usage`) y mantiene al día la barra de estado y los paneles.
//
// Así el número que se muestra es exactamente el que usa el bloqueo de OpenCode, y cambiar el
// límite desde el panel llama a `setLimit`, que lo aplica en caliente (sin reiniciar nada).
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { BudgetState, Usage } from './protocol'

const STATUS_ID = 'budget'
const REFRESH_MS = 30_000
const CACHE_MS = 5_000
const TIMEOUT_MS = 6_000
const ALERT_KEY = 'alert'

type Service = { url: string; password?: string }

/** `~/.local/state/opencode/service.json` (o `XDG_STATE_HOME`). */
export function serviceFile(): string {
  const override = process.env.ORCA_DAILY_BUDGET_SERVICE_FILE
  if (override) return override
  const state = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state')
  return join(state, 'opencode', 'service.json')
}

async function readService(): Promise<Service> {
  const raw = await readFile(serviceFile(), 'utf8')
  const parsed = JSON.parse(raw) as { url?: unknown; password?: unknown }
  if (typeof parsed.url !== 'string' || parsed.url.length === 0) {
    throw new Error('service.json no trae la URL del servicio de OpenCode')
  }
  return {
    url: parsed.url.replace(/\/+$/, ''),
    password: typeof parsed.password === 'string' ? parsed.password : undefined
  }
}

async function callRpc<T>(method: string, input: unknown): Promise<T> {
  const service = await readService()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (service.password) {
    const token = Buffer.from(`opencode:${service.password}`).toString('base64')
    headers.authorization = `Basic ${token}`
  }
  const response = await fetch(`${service.url}/api/rpc/daily-budget/${method}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'el plugin daily-budget no está cargado en OpenCode'
        : `OpenCode respondió ${response.status}`
    )
  }
  const body = (await response.json()) as { output?: unknown }
  return body.output as T
}

function isUsage(value: unknown): value is Usage {
  if (typeof value !== 'object' || value === null) return false
  const usage = value as Record<string, unknown>
  return (
    typeof usage.day === 'string' &&
    typeof usage.total === 'number' &&
    typeof usage.limit === 'number' &&
    typeof usage.month === 'number' &&
    typeof usage.allTime === 'number'
  )
}

const money = (n: number): string => `$${n.toFixed(2)}`

function toneFor(usage: Usage): 'success' | 'warning' | 'danger' {
  if (usage.total >= usage.limit) return 'danger'
  if (usage.total >= usage.limit * 0.8) return 'warning'
  return 'success'
}

let timer: ReturnType<typeof setInterval> | undefined
let stopped = false

export default function activate(orca: OrcaWorkerApi): void {
  stopped = false
  let cache: { at: number; state: BudgetState } | undefined
  let inflight: Promise<BudgetState> | undefined

  async function read(): Promise<BudgetState> {
    try {
      const usage = await callRpc<unknown>('usage', {})
      if (!isUsage(usage)) throw new Error('respuesta inesperada del plugin daily-budget')
      return { connected: true, usage }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { connected: false, error: message }
    }
  }

  /** Estado con caché corta: el panel puede pedir varias veces sin castigar a OpenCode. */
  async function current(force = false): Promise<BudgetState> {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.state
    if (!inflight) {
      inflight = read()
        .then(async (state) => {
          cache = { at: Date.now(), state }
          await publish(state)
          return state
        })
        .finally(() => {
          inflight = undefined
        })
    }
    return inflight
  }

  async function publish(state: BudgetState): Promise<void> {
    if (stopped) return
    const usage = state.usage
    const text = usage
      ? `${money(usage.total)} / ${money(usage.limit)}`
      : state.error
        ? 'sin conexión'
        : '— / —'
    const tooltip = usage
      ? `Hoy ${money(usage.total)} de ${money(usage.limit)} · mes ${money(usage.month)} · histórico ${money(usage.allTime)}`
      : `Daily Budget: ${state.error ?? 'sin datos'}`
    await orca.host
      .call('statusBar.update', {
        id: STATUS_ID,
        text,
        tone: usage ? toneFor(usage) : 'neutral',
        tooltip
      })
      .catch(() => undefined)
    orca.panels.post('budget.changed', state)
    if (usage) void alert(orca, usage)
  }

  orca.panels.handle('budget.usage', async () => current())

  orca.panels.handle('budget.setLimit', async ({ limit }) => {
    if (!Number.isFinite(limit) || limit <= 0 || limit > 10_000) {
      throw new Error('El límite debe ser un número entre 0.01 y 10000')
    }
    try {
      await callRpc('setLimit', { limit })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { connected: false, error: message }
    }
    cache = undefined
    return current(true)
  })

  timer = setInterval(() => {
    if (stopped) return
    void current(true)
  }, REFRESH_MS)

  // Primer refresco al arrancar: la barra de estado deja de decir "— / —".
  void current(true)
}

/** Avisa una sola vez por día al pasar el 80% y al alcanzar el tope. */
async function alert(orca: OrcaWorkerApi, usage: Usage): Promise<void> {
  const level =
    usage.total >= usage.limit ? 'limit' : usage.total >= usage.limit * 0.8 ? 'warning' : 'none'
  if (level === 'none') return
  try {
    const stored = (await orca.storage.get(ALERT_KEY)) as { day?: string; level?: string } | null
    if (stored && stored.day === usage.day && stored.level === level) return
    await orca.storage.set(ALERT_KEY, { day: usage.day, level })
    const body =
      level === 'limit'
        ? `Has gastado ${money(usage.total)} de ${money(usage.limit)} hoy. OpenCode bloqueará nuevos prompts hasta medianoche.`
        : `Has gastado ${money(usage.total)} de ${money(usage.limit)} hoy (${Math.round((usage.total / usage.limit) * 100)}%).`
    await orca.host
      .call('notifications.show', { title: 'Daily Budget', body })
      .catch(() => undefined)
  } catch {
    /* el aviso es best-effort */
  }
}

export function deactivate(): void {
  stopped = true
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}
