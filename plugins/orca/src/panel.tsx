// Panel del plugin. Sin build: Orca compila el TSX al cargar.
import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  Field,
  Heading,
  IconButton,
  Input,
  KeyValue,
  plugin,
  Progress,
  read,
  Row,
  Separator,
  set,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { BudgetState, Usage } from './protocol'

/** Lo que el worker reportó por última vez. */
const state = atom<BudgetState | null>(null)
/** El límite que se está escribiendo en el formulario. */
const draft = atom('limit-draft', '')
const busy = atom(false)
const notice = atom<string | null>(null)

const money = (n: number): string => `$${n.toFixed(2)}`

function percent(usage: Usage): number {
  if (usage.limit <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((usage.total / usage.limit) * 100)))
}

function syncDraft(next: BudgetState): void {
  if (!next.usage) return
  if (read(draft) === '') set(draft, String(next.usage.limit))
}

async function refresh(): Promise<void> {
  try {
    const next = await plugin.request('budget.usage')
    set(state, next)
    syncDraft(next)
    set(notice, null)
  } catch (error) {
    set(notice, error instanceof Error ? error.message : String(error))
  }
}

async function saveLimit(): Promise<void> {
  const limit = Number(read(draft).replace(',', '.'))
  if (!Number.isFinite(limit) || limit <= 0 || limit > 10_000) {
    set(notice, 'Escribe un límite válido, por ejemplo 2.50')
    return
  }
  set(busy, true)
  set(notice, null)
  try {
    const next = await plugin.request('budget.setLimit', { limit })
    set(state, next)
    if (next.usage) set(draft, String(next.usage.limit))
    if (!next.connected) set(notice, next.error ?? 'No se pudo cambiar el límite')
  } catch (error) {
    set(notice, error instanceof Error ? error.message : String(error))
  } finally {
    set(busy, false)
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('budget.changed', (next) => set(state, next)))
  void refresh()
}

export default function Panel() {
  const current = read(state)
  const usage = current?.usage
  const error = current?.connected === false ? (current.error ?? 'Sin conexión') : null
  const message = read(notice)
  const pct = usage ? percent(usage) : 0
  const tone = usage ? (pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'success') : 'neutral'

  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Heading>Daily Budget</Heading>
        <Row gap="xs" align="center">
          <Badge tone={tone}>{usage ? `${pct}%` : 'sin datos'}</Badge>
          <IconButton icon="refresh" label="Actualizar gasto" onPress={refresh} />
        </Row>
      </Row>

      {error ? (
        <Callout tone="danger" title="No pude leer el gasto" icon="warning">
          {error}
        </Callout>
      ) : null}

      {message ? <Callout tone="warning" title="Revisa el límite">{message}</Callout> : null}

      <Card title="Hoy" description={usage ? `Día ${usage.day} · se reinicia a medianoche` : undefined}>
        <Stack gap="sm">
          <Heading level={2}>
            {usage ? `${money(usage.total)} de ${money(usage.limit)}` : '— de —'}
          </Heading>
          <Progress label="Gasto de hoy" labelHidden value={pct} />
          <Text muted size="xs">
            {usage
              ? pct >= 100
                ? 'Tope alcanzado: OpenCode bloqueará nuevos prompts hasta medianoche.'
                : `Te quedan ${money(Math.max(0, usage.limit - usage.total))} hoy.`
              : 'Esperando al worker…'}
          </Text>
        </Stack>
      </Card>

      <KeyValue
        items={[
          { label: 'Hoy', value: usage ? money(usage.total) : '—' },
          { label: 'Límite diario', value: usage ? money(usage.limit) : '—' },
          { label: 'Este mes', value: usage ? money(usage.month) : '—' },
          { label: 'Histórico', value: usage ? money(usage.allTime) : '—' }
        ]}
      />

      <Separator />

      <Field label="Límite diario (USD)" description="Se aplica al instante en OpenCode.">
        <Row gap="xs" align="end">
          <Input
            label="Límite diario (USD)"
            labelHidden
            value={read(draft)}
            placeholder="2.00"
            onChange={(value) => set(draft, value)}
            onSubmit={() => void saveLimit()}
          />
          <Button onPress={saveLimit} disabled={read(busy)}>
            Guardar
          </Button>
        </Row>
      </Field>

      <Text muted size="xs">
        Datos del plugin daily-budget de OpenCode (hoy, mes e histórico reales). El bloqueo lo hace
        OpenCode; este panel solo muestra y cambia el tope.
      </Text>
    </Stack>
  )
}
