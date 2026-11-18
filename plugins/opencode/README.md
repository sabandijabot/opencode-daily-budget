# opencode-daily-budget (plugin de OpenCode)

Límite de gasto diario para **OpenCode V2**. Widget `💰 $X.XX / $3.00 hoy` en el footer; cuando el
gasto del día alcanza el límite, **bloquea el envío de prompts** hasta el reinicio de medianoche
(o hasta subir el límite).

## Qué hace

- Acumula el gasto de **todas** las sesiones del día (incluye subagentes y gasto auxiliar de
  título/compaction). Es contador por día, no por sesión: sobrevive a sesiones nuevas, cierre del
  TUI y reinicios del servicio.
- Cuando `total >= dailyLimit`, el hook de admisión de prompts (`session.hook("prompt")`) rechaza
  el envío; OpenCode no lo admite.
- Comandos: `/costo` (hoy / mes / histórico) y `/limite` (cambiar límite).
- Widget clickable para cambiar el límite al vuelo.

## Instalación

Copia esta carpeta a tu config global de OpenCode y registra el plugin:

```
~/.config/opencode/plugins/daily-budget/
├── index.ts   (parte servidor: conteo + bloqueo)
├── rpc.ts     (contrato RPC; también lo usa el plugin de Orca)
└── tui.tsx    (widget + comandos)
```

```jsonc
{
  "plugins": [
    { "package": "./plugins/daily-budget", "options": { "dailyLimit": 3 } }
  ]
}
```

Reinicia el TUI (o `opencode service restart`). La config se recarga sola al editar archivos.

## Nota V2 (importante)

En OpenCode V2 **no existe el evento `message.updated`** y los mensajes
(`/session/{id}/context`, `/message`) llegan con `cost: 0`. El costo real vive en:

- `SessionInfo.cost` — acumulado por sesión (visible en `/api/session`).
- El evento **`session.usage.updated`** → `{ sessionID, cost, tokens }` (contador acumulado por
  sesión).

Este plugin suma por delta sobre ese contador (sembrado al arranque con los costos reales vía
`ctx.session.list`) y aplica un piso de auto-corrección (`total = max(total, suma de sesiones
creadas hoy)`) tras cada `session.execution.*`, así se corrige ante reinicios/recargas sin doble
conteo.

Probado con OpenCode **v2.2.5**.

## RPC para el plugin de Orca

El plugin registra `usage` y `setLimit` con `Rpc.define`. OpenCode V2 los expone por HTTP:

```
POST {service.url}/api/rpc/daily-budget/usage
POST {service.url}/api/rpc/daily-budget/setLimit   {"input":{"limit":2}}
```

`service.url` y la contraseña están en `~/.local/state/opencode/service.json`
(auth Basic `opencode:<password>`). El plugin de Orca de este repo consume ese RPC.
