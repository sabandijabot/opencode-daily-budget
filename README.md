# opencode-daily-budget

L├¡mite de gasto diario para OpenCode V2. Widget `­ƒÆ░ $X.XX / $3.00 hoy` en el
footer; cuando el gasto del d├¡a alcanza el l├¡mite, **bloquea el env├¡o de
prompts** hasta el reinicio de medianoche (o hasta subir el l├¡mite).

## Qu├® hace

- Acumula el gasto de **todas** las sesiones del d├¡a (incluye subagentes y
  gasto auxiliar de t├¡tulo/compaction). Es contador por d├¡a, no por sesi├│n:
  sobrevive a sesiones nuevas, cierre del TUI y reinicios del servicio.
- Cuando `total >= dailyLimit`, el hook de admisi├│n de prompts
  (`session.hook("prompt")`) rechaza el env├¡o ÔÇö OpenCode no lo admite.
- Comandos: `/costo` (hoy / mes / hist├│rico) y `/limite` (cambiar l├¡mite).
- Widget clickable para cambiar el l├¡mite al vuelo.

## Instalaci├│n

Copia la carpeta a tu config global de OpenCode y registra el plugin:

```text
.config/opencode/plugins/daily-budget/
Ôö£ÔöÇÔöÇ index.ts   (parte servidor: conteo + bloqueo)
Ôö£ÔöÇÔöÇ rpc.ts     (contrato RPC)
ÔööÔöÇÔöÇ tui.tsx    (widget + comandos)
```

```jsonc title="~/.config/opencode/opencode.jsonc"
{
  "plugins": [
    { "package": "./plugins/daily-budget", "options": { "dailyLimit": 3 } }
  ]
}
```

Reinicia el TUI (o `opencode service restart`) y listo. Config recarga solo
al editar archivos.

## Nota V2 (importante)

En OpenCode V2 **no existe el evento `message.updated`** y los mensajes
(`/session/{id}/context`, `/message`) llegan con `cost: 0`. El costo real vive
en:

- `SessionInfo.cost` ÔÇö acumulado por sesi├│n (visible en `/api/session`)
- El evento **`session.usage.updated`** ÔåÆ `{ sessionID, cost, tokens }`
  (contador acumulado por sesi├│n)

Este plugin suma por delta sobre ese contador (sembrado al arranque con los
costos reales v├¡a `ctx.session.list`) y aplica un piso de auto-correcci├│n
(`total = max(total, suma de sesiones creadas hoy)`) tras cada
`session.execution.*` ÔÇö as├¡ se corrige ante reinicios/recargas sin doble
conteo.

Configurado y probado con OpenCode **v2.2.5**.
