// Contrato RPC compartido entre el plugin del servidor (index.ts) y el plugin
// del panel/TUI (tui.tsx). El servidor implementa "usage" y emite "updated"
// cada vez cambia el total del día.

import { Rpc } from "@opencode/plugin/rpc"

export const DailyBudgetRpc = Rpc.define({
  id: "daily-budget",
  methods: {
    usage: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          day: { type: "string" }, // día local de la contabilidad, ej. "2026-10-25"
          total: { type: "number" }, // gasto de hoy, USD
          limit: { type: "number" }, // límite diario, USD
          month: { type: "number" }, // gasto del mes calendario, USD
          allTime: { type: "number" }, // gasto histórico, USD
        },
        required: ["day", "total", "limit", "month", "allTime"],
        additionalProperties: false,
      },
    },
    setLimit: {
      input: {
        type: "object",
        properties: { limit: { type: "number" } },
        required: ["limit"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { limit: { type: "number" } },
        required: ["limit"],
        additionalProperties: false,
      },
      errors: {
        invalid: {
          type: "object",
          properties: { limit: { type: "number" } },
          required: ["limit"],
          additionalProperties: false,
        },
      },
    },
  },
  events: {
    updated: { schema: { type: "object", additionalProperties: false } },
  },
})
