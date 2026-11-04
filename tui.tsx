// daily-budget / tui — panel del límite de gasto diario
//
// Widget visible en el footer de la pantalla de inicio y del prompt de sesión:
//   💰 $0.42 / $3.00 hoy
// Colores: gris (normal), ámbar (≥50 % del límite), rojo (límite alcanzado).
// Comando /costo: detalle de hoy, mes e histórico.
// Los datos vienen del RPC "daily-budget" implementado en index.ts (servidor).

import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { DailyBudgetRpc } from "./rpc"

const GRIS = "#9ea0a6"
const AMBAR = "#e5a04d"
const ROJO = "#e5484d"

export default Plugin.define({
  id: "daily-budget.tui",
  async setup(context: any) {
    const rpc = context.client.rpc(DailyBudgetRpc)

    const [usage, setUsage] = createSignal<any>(null)
    const refresh = async () => {
      try {
        setUsage(await rpc.usage({}))
      } catch (e) {
        // el plugin del servidor puede no estar listo todavía; reintenta en el próximo update
        console.error("[daily-budget/tui] no se pudo consultar el consumo", e)
      }
    }
    await refresh()
    const unsub = rpc.events.on("updated", () => void refresh())

    const label = (u: any) => `💰 $${(u?.total ?? 0).toFixed(2)} / $${(u?.limit ?? 3).toFixed(2)} hoy`
    const color = (u: any) =>
      !u || typeof u.total !== "number"
        ? GRIS
        : u.total >= u.limit
          ? ROJO
          : u.total >= u.limit * 0.5
            ? AMBAR
            : GRIS

    // cambiar el límite diario desde el click del widget (o el prompt abierto)
    const changeLimit = async () => {
      const raw: unknown = await context.ui.dialog.prompt({
        title: "Límite diario de gasto ($)",
        placeholder: String((usage()?.limit ?? 3).toFixed(2)),
      })
      if (raw === undefined || raw === null || String(raw).trim() === "") return // Esc o vacío: sin cambios
      const parsed = Number(String(raw).replace("$", "").replace(",", ".").trim())
      if (!Number.isFinite(parsed) || parsed <= 0) {
        context.ui.toast.show({ title: "Daily budget", message: `Valor inválido: ${raw}`, variant: "error", duration: 4000 })
        return
      }
      const out: any = await rpc.setLimit({ limit: parsed })
      setUsage((prev: any) => ({ ...(prev ?? {}), limit: out?.limit ?? parsed }))
      context.ui.toast.show({
        title: "Daily budget",
        message: `Límite diario cambiado a $${(out?.limit ?? parsed).toFixed(2)}`,
        variant: "success",
        duration: 3000,
      })
    }

    const widgets = [
      context.ui.slot({
        append: "home.footer.status",
        render: () => (
          <text
            fg={color(usage())}
            onMouseDown={() => void changeLimit()}
            onClick={() => void changeLimit()}
          >
            {label(usage())}
          </text>
        ),
      }),
      context.ui.slot({
        append: "prompt.footer.status",
        render: () => (
          <text
            fg={color(usage())}
            onMouseDown={() => void changeLimit()}
            onClick={() => void changeLimit()}
          >
            {label(usage())}
          </text>
        ),
      }),
    ]

    // comando /costo — consumo detallado
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "dailybudget.usage",
          title: "Ver consumo de hoy / mes / histórico",
          group: "Daily budget",
          palette: true,
          slash: { name: "costo", aliases: ["gasto"] },
          enabled: () => true,
          run: async () => {
            await refresh()
            const u = usage() ?? { total: 0, limit: 3, month: 0, allTime: 0, day: "" }
            const done = u.total >= u.limit ? " — LÍMITE ALCANZADO, prompts bloqueados" : ""
            await context.ui.dialog.alert({
              title: "Consumo de OpenCode",
              message: `Hoy (${u.day}): $${u.total.toFixed(2)} de $${u.limit.toFixed(2)}${done}\nEste mes: $${u.month.toFixed(2)}\nHistórico: $${u.allTime.toFixed(2)}\n\nCambia el límite clickeando el widget del footer.`,
            })
          },
        },
        {
          id: "dailybudget.setlimit",
          title: "Cambiar límite diario de gasto",
          group: "Daily budget",
          palette: true,
          slash: { name: "limite", aliases: ["limit"] },
          enabled: () => true,
          run: async () => {
            await changeLimit()
          },
        },
      ],
    }))

    return () => {
      unsub()
      for (const s of widgets) {
        try {
          if (typeof s === "function") s()
        } catch {
          /* noop */
        }
      }
    }
  },
})
