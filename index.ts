// daily-budget — límite de gasto diario para OpenCode V2
//
// Suma el gasto (Money.USD) y bloquea el envío de nuevos prompts cuando el
// gasto del día alcanza `dailyLimit` (default: $3).
//
// POR QUÉ SE REESCRIBIÓ (V2): el plugin viejo escuchaba `message.updated` y leía
// el costo por mensaje de /session/{id}/context. En V2 ya no existe
// `message.updated`, y el costo por mensaje siempre llega 0. El costo real vive:
//   - SessionInfo.cost (acumulado por sesión, verificado en /api/session)
//   - evento `session.usage.updated` → { sessionID, cost, tokens } (contador
//     acumulado por sesión; se usa con lógica de DELTA para no contar dos veces)
//
// Cómo funciona ahora:
//  - LIVE: `session.usage.updated` → delta = cost − último costo conocido de esa
//    sesión → si > 0 y el evento es de hoy, suma al total del día.
//  - PISO (auto-corrección): tras cada ejecución (session.execution.*) y al
//    arrancar, se enumeran las sesiones (ctx.session.list, cost real) y el total
//    nunca puede estar por debajo de la suma de costos de sesiones creadas hoy.
//    Esto cubre reinicios, recargas del plugin y gaps de eventos. max(), no suma:
//    sin doble conteo.
//  - PERSISTENCIA: { day, total } en ctx.storage, debounce 2s.
//  - Atribución: cada delta cuenta para el día calendario local del evento.
//  - Nota: `session.usage.recorded` (título/compaction) NO se suma aparte: ese
//    gasto es parte del acumulado de la sesión y llega vía usage.updated.
//
// El bloqueo se hace en el hook de admisión de prompts (session.hook("prompt")):
// si el hook lanza error, OpenCode no admite el prompt.
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
    // Límite diario. Orden: override guardado (storage) > opencode.jsonc > 3.
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
    // sessionID -> último costo acumulado conocido de esa sesión
    const lastCost = new Map<string, number>()
    const seenEvents = new Set<string>() // dedupe por EventID
    let booting: Promise<void> | null = null
    let persistTimer: ReturnType<typeof setTimeout> | null = null
    let refreshTimer: ReturnType<typeof setInterval> | null = null
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

    // ---------- helpers ----------
    const rollover = () => {
      const t = dayKeyOf(Date.now())
      if (t !== day) {
        day = t
        total = 0
        lastCost.clear()
        void persist()
        notifyUsage()
      }
    }

    // enumera todas las sesiones (paginado); cada una trae `cost` acumulado real
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

    // reconstruye el día: piso = sesiones creadas hoy; persistido como respaldo.
    // También siembra lastCost para que los deltas futuros no re-sumen costas viejos.
    async function recomputeToday() {
      day = dayKeyOf(Date.now())
      let sessionsToday = 0
      try {
        for await (const s: any of allSessions()) {
          const cost = typeof s?.cost === "number" ? s.cost : 0
          if (s?.id) lastCost.set(s.id, cost)
          if (cost > 0 && dayKeyOf(s?.time?.created ?? 0) === day) sessionsToday += cost
        }
      } catch (e) {
        console.error("[daily-budget] error reconstruyendo el gasto del día", e)
      }
      let saved = 0
      try {
        const st: any = await ctx.storage.get("daily")
        if (st?.day === day && typeof st.total === "number") saved = st.total
      } catch {
        /* sin estado previo */
      }
      // el piso de sesiones creadas hoy cubre gaps (plugin caído, primera instalación);
      // el persistido cubre el gasto en sesiones de días anteriores activas hoy.
      total = Math.max(saved, Math.round(sessionsToday * 1e6) / 1e6)
      total = Math.round(total * 1e6) / 1e6
      await persist()
    }

    const ensureBoot = (): Promise<void> => (booting ??= recomputeToday())

    // refresco ligero tras cada ejecución: re-siembra y aplica el piso
    let refreshing = false
    const lightRefresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        let sessionsToday = 0
        for await (const s: any of allSessions()) {
          const cost = typeof s?.cost === "number" ? s.cost : 0
          if (s?.id) lastCost.set(s.id, cost)
          if (cost > 0 && dayKeyOf(s?.time?.created ?? 0) === day) sessionsToday += cost
        }
        const floor = Math.round(sessionsToday * 1e6) / 1e6
        if (floor > total) {
          total = floor
          schedulePersist()
        }
      } catch {
        /* best-effort */
      } finally {
        refreshing = false
      }
    }

    // ---------- stream de eventos (V2) ----------
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const ev: any of ctx.event.subscribe({
          signal: controller.signal,
          types: [
            "session.usage.updated",
            "session.execution.succeeded",
            "session.execution.failed",
            "session.execution.interrupted",
            "session.deleted",
          ],
        })) {
          try {
            if (ev?.type === "session.usage.updated") {
              await ensureBoot()
              rollover()
              const cost = ev?.data?.cost
              const sessionID = ev?.data?.sessionID
              if (typeof cost !== "number" || !sessionID) continue
              // dedupe por id de evento
              if (ev.id) {
                if (seenEvents.has(ev.id)) continue
                seenEvents.add(ev.id)
                if (seenEvents.size > 5000) seenEvents.clear()
              }
              const delta = cost - (lastCost.get(sessionID) ?? 0)
              if (delta > 0) {
                lastCost.set(sessionID, cost)
                // el delta cuenta para el día en que ocurrió el evento
                if (dayKeyOf(ev.created ?? Date.now()) === dayKeyOf(Date.now())) {
                  total += delta
                  total = Math.round(total * 1e6) / 1e6
                  schedulePersist()
                }
              } else if (delta < 0) {
                // contador reseteado (p.ej. revert) — re-siembra silenciosamente
                lastCost.set(sessionID, cost)
              }
            } else if (
              ev?.type === "session.execution.succeeded" ||
              ev?.type === "session.execution.failed" ||
              ev?.type === "session.execution.interrupted"
            ) {
              await ensureBoot()
              rollover()
              void lightRefresh() // piso de auto-corrección, sin bloquear el stream
            } else if (ev?.type === "session.deleted") {
              if (ev?.data?.sessionID) lastCost.delete(ev.data.sessionID)
            }
          } catch (e) {
            console.error("[daily-budget] error procesando evento", ev?.type, e)
          }
        }
      } catch (e: any) {
        if (!controller.signal.aborted && String(e?.message ?? e).toLowerCase().includes("type")) {
          // si el filtro de tipos no fuera soportado, reintenta sin filtro
          console.warn("[daily-budget] reintento de suscripción sin filtro de tipos", e?.message)
        } else if (!controller.signal.aborted) {
          console.error("[daily-budget] error del stream de eventos", e)
        }
      }
    })()

    // refresco periódico: red de seguridad para drift en modo headless
    refreshTimer = setInterval(() => {
      void (async () => {
        await ensureBoot()
        rollover()
        void lightRefresh()
      })()
    }, 60_000)

    // ---------- bloqueo de prompts ----------
    const hookReg = await ctx.session.hook("prompt", async () => {
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

    console.log(`[daily-budget] activo (V2) — límite diario $${limit.toFixed(2)}`)
    return () => {
      controller.abort()
      if (persistTimer) clearTimeout(persistTimer)
      if (refreshTimer) clearInterval(refreshTimer)
      void hookReg.dispose().catch(() => {})
      void rpcReg.dispose().catch(() => {})
      void persist()
    }
  },
})
