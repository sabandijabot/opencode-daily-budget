// Contrato panel <-> worker, declarado una vez: lo leen src/panel.tsx y src/worker.ts.
export {}

/** Lo que el plugin daily-budget de OpenCode responde por su RPC `usage`. */
export type Usage = {
  day: string
  total: number
  limit: number
  month: number
  allTime: number
}

/** Estado que el worker publica a los paneles abiertos. */
export type BudgetState = {
  connected: boolean
  usage?: Usage
  error?: string
}

declare module 'orca' {
  interface PluginRequests {
    /** Gasto de hoy, límite, mes e histórico leídos del plugin de OpenCode. */
    'budget.usage': { input?: Record<string, never>; output: BudgetState }
    /** Cambia el límite diario en OpenCode y responde el estado nuevo. */
    'budget.setLimit': { input: { limit: number }; output: BudgetState }
  }
  interface PluginPanelEvents {
    /** El worker refresca (poll o cambio de límite) y avisa a los paneles abiertos. */
    'budget.changed': BudgetState
  }
}
