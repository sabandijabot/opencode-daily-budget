// daily-budget — límite de gasto diario para OpenCode
//
// Suma el costo (Money.USD) de cada mensaje de la cuenta local y bloquea el envío
// de nuevos prompts cuando el gasto del día alcanza `dailyLimit` (default: $3).
//
// Cómo funciona:
//  - Suscripción al stream de eventos del servicio: `message.updated` trae
//    { sessionID, info } donde info es Session.Message.Info (con `cost` y `time.created`).
//  - Se acumula por DELTA (costo nuevo − último costo visto del mensaje), así que
//    los updates acumulativos del streaming no cuentan dos veces.
//  - En frío (arranque/reinicio del servicio) se reconstruye el total del día
//    enumerando sesiones y mensajes vía la API del servicio; el contador persiste
//    en ctx.storage como backup.
//  - Atribución: un mensaje cuenta para el día calendario (local) en que fue
//    creado. Edge case documentado: un mensaje creado un poco antes de medianoche
//    que sigue generando después cuenta en el día de su creación.
//  - El bloqueo se hace en el hook de admisión de prompts (session.hook("prompt")):
//    si el hook falla/lanza error, OpenCode no admite el prompt.
//
// Límite configurable en opencode.jsonc:
//   "plugins": [{ "package": "./plugins/daily-budget", "options": { "dailyLimit": 3 } }]

import { Plugin } from "@opencode/plugin"
import { DailyBudgetRpc } from "./rpc"

function dayKeyOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default Plugin.define({
  id: "daily-budget",
  async setup(ctx: any) {
    // Límite diario. Orden de decisión: override guardado por el usuario desde
    // el panel (storage) > opciones de opencode.jsonc > 3. El valor del config
    // aplica solo la primera vez; después gana el que guardes con el click o /costo.
    let limit = 3
    if (typeof ctx.options?.dailyLimit === "number" && ctx.options.dailyLimit > 0) limit = ctx.options.dailyLimit
    try {
      const savedConfig: any = await ctx.storage.get("config")
      if (typeof savedConfig?.limit === "number" && savedConfig.limit > 0) limit = savedConfig.limit
    } catch {
      /* primer arranque sin override guardado */
    }

    // ---------- estado ----------
    let day = dayKeyOf(Date.now())
    let total = 0
    // messageID -> último costo acumulado visto (en memoria; se reconstruye en frío)
    const seenCost = new Map<string, number>()
    let booting: Promise<void> | null = null
    let persistTimer: ReturnType<typeof setTimeout> | null = null
    // notifica al panel (TUI) que el total cambió; se cablea tras registrar el RPC
    let notifyUsage: () => void = () => {}

    const persist = async () => {
      try {
        await ctx.storage.set("daily", { day, total: Math.round(total * 1e6) / 1e6 })
      } catch {
        /* persistencia best-effort */
      }
    }
    const schedulePersist = () => {
      if (persistTimer) return
      persistTimer = setTimeout(() => {
        persistTimer = null
        void persist()
        notifyUsage()
      }, 2000)
    }

    // ---------- helpers de cuentas ----------
    const rollover = () => {
      const t = dayKeyOf(Date.now())
      if (t !== day) {
        day = t
        total = 0
        void persist()
        notifyUsage()
      }
    }
    const createdToday = (ms: unknown): boolean =>
      typeof ms !== "number" || dayKeyOf(ms as number) === dayKeyOf(Date.now())

    // enumera todas las sesiones (paginado)
    async function* allSessions() {
      let cursor: unknown = undefined
      for (let guard = 0; guard < 100; guard++) {
        const page: any = await ctx.session.list({ limit: 100, ...(cursor ? { cursor } : {}) })
        const items = Array.isArray(page) ? page : (page?.data ?? [])
        yield* items
        cursor = page?.cursor?.next
        if (!cursor || items.length === 0) break
      }
    }

    // reconstruye el total del día y el mapa de costos vistos
    async function recomputeToday() {
      day = dayKeyOf(Date.now())
      total = 0
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      const midnight = startOfToday.getTime()
      try {
        for await (const s: any of allSessions()) {
          const time = s?.time ?? {}
          const lastActivity = Math.max(time.updated ?? 0, time.created ?? 0)
          if (lastActivity < midnight) continue
          let msgs: any
          try {
            msgs = await ctx.session.context({ sessionID: s.id })
          } catch {
            continue // sesión eliminada mientras se enumeraba
          }
          const items = Array.isArray(msgs) ? msgs : (msgs?.data ?? [])
          for (const m of items) {
            const cost = m?.cost
            if (typeof cost !== "number" || cost <= 0) continue
            const id = m?.id
            if (id) seenCost.set(id, cost)
            if (createdToday(m?.time?.created)) total += cost
          }
        }
      } catch (e) {
        console.error("[daily-budget] error reconstruyendo el gasto del día", e)
      }
      total = Math.round(total * 1e6) / 1e6
      await persist()
    }

    const ensureBoot = (): Promise<void> => (booting ??= recomputeToday())

    const handleCostUpdate = (info: any) => {
      const cost = info?.cost
      if (typeof cost !== "number" || cost <= 0) return
      const id = info?.id
      const last = id ? (seenCost.get(id) ?? 0) : 0
      const delta = cost - last
      if (delta <= 0) return
      if (id) seenCost.set(id, cost)
      if (createdToday(info?.time?.created)) {
        total += delta
        schedulePersist()
      }
    }

    // ---------- stream de eventos ----------
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const ev: any of ctx.event.subscribe({ signal: controller.signal })) {
          const props = ev?.properties ?? ev
          if (ev?.type === "message.updated") {
            await ensureBoot()
            handleCostUpdate(props?.info)
            rollover()
          } else if (ev?.type === "message.removed" || ev?.type === "session.deleted") {
            await ensureBoot()
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) console.error("[daily-budget] error del stream de eventos", e)
      }
    })()

    // ---------- bloqueo de prompts ----------
    await ctx.session.hook("prompt", async () => {
      await ensureBoot()
      rollover()
      if (total >= limit) {
        throw new Error(
          `[daily-budget] Límite diario alcanzado: has gastado $${total.toFixed(2)} de $${limit.toFixed(2)} hoy (${day}). El contador se reinicia después de medianoche, o sube "dailyLimit" en opencode.jsonc.`,
        )
      }
    })

    // ---------- panel (TUI) y otros clientes: RPC ----------
    const rpcReg = await ctx.rpc.register(DailyBudgetRpc, {
      usage: async () => {
        await ensureBoot()
        rollover()
        const startOfMonth = new Date()
        startOfMonth.setDate(1)
        startOfMonth.setHours(0, 0, 0, 0)
        let month = 0
        let allTime = 0
        try {
          for await (const s: any of allSessions()) {
            const c = s?.cost
            if (typeof c !== "number" || c <= 0) continue
            allTime += c
            if ((s?.time?.created ?? 0) >= startOfMonth.getTime()) month += c
          }
        } catch (e) {
          console.error("[daily-budget] error calculando totales del mes/histórico", e)
        }
        const round = (n: number) => Math.round(n * 1e6) / 1e6
        return { day, total: round(total), limit, month: round(month), allTime: round(allTime) }
      },
      setLimit: async (input: any, rpcContext: any) => {
        const next = input?.limit
        if (typeof next !== "number" || !Number.isFinite(next) || next <= 0 || next > 10_000) {
          if (typeof rpcContext?.error === "function") {
            rpcContext.error("invalid", `Límite inválido: ${next}`, { limit: Number(next) || 0 })
          }
          return { limit }
        }
        limit = next
        await ctx.storage.set("config", { limit })
        notifyUsage()
        console.log(`[daily-budget] límite diario cambiado a $${limit.toFixed(2)}`)
        return { limit }
      },
    })
    notifyUsage = () => {
      void rpcReg.events.emit("updated", {})
    }

    console.log(`[daily-budget] activo — límite diario $${limit.toFixed(2)}`)
    return () => {
      controller.abort()
      if (persistTimer) clearTimeout(persistTimer)
      void rpcReg.dispose().catch(() => {})
      void persist()
    }
  },
})
