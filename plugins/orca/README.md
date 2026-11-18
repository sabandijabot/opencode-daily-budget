# Daily Budget (plugin de Orca)

Muestra el gasto diario de **OpenCode** dentro de Orca y deja cambiar el tope sin salir de la app.
Es la versión Orca del plugin [`opencode-daily-budget`](../opencode): el bloqueo de prompts sigue
viviendo en OpenCode; este plugin pone la cara visible.

## Qué hace

- **Barra de estado**: `$0.03 / $2.00` con icono de gauge. Verde por debajo del 80%, ámbar al 80%,
  rojo al llegar al tope. Tooltip con hoy, mes e histórico.
- **Panel "Daily Budget"** (sidebar): gasto de hoy, barra de progreso, restante, hoy/mes/histórico y
  un campo para cambiar el límite diario.
- **Cambio de límite en caliente**: llama al RPC `setLimit` del plugin de OpenCode, así que el
  bloqueo usa el valor nuevo al instante (sin reiniciar OpenCode).
- **Aviso de escritorio** una vez al día al pasar el 80% y al alcanzar el tope.

## De dónde salen los datos

Del plugin `daily-budget` que ya corre dentro de OpenCode, por su RPC HTTP:

```
POST {service.url}/api/rpc/daily-budget/usage
POST {service.url}/api/rpc/daily-budget/setLimit
```

`service.url` y la contraseña se leen de `~/.local/state/opencode/service.json`
(o `$XDG_STATE_HOME/opencode/service.json`). Autenticación Basic `opencode:<password>`.

Así el número mostrado es exactamente el que usa el bloqueo (incluye deltas de sesiones viejas
usadas hoy), no una re-suma aproximada de la base de datos.

## Requisitos

- Orca ≥ 1.4.248 (`statusBarItems`).
- OpenCode V2 con el plugin `daily-budget` cargado en `~/.config/opencode/opencode.jsonc`.
- Que el servicio de OpenCode esté corriendo (lo arranca Orca al abrir un chat de OpenCode).

## Instalación

Desde el catálogo o una carpeta:

```powershell
orca plugin install <ruta-o-url>/plugins/orca
```

En desarrollo:

```powershell
orca plugin dev load "<ruta>\plugins\orca" --approve <fingerprint>
orca plugin open local.daily-budget --panel budget
```

Para iterar: `orca plugin dev watch <ruta>\plugins\orca --check --shot <ruta>\plugins\orca\.orca\shots`.

## Desarrollo

```powershell
npx tsc -p .                       # tipos (necesita npm install)
orca plugin test .                 # tests del panel y del worker
orca plugin check .                # renderiza el panel contra OpenCode real
orca plugin validate .             # manifiesto
```

## Limitaciones

- Solo mide OpenCode. Claude Code, Codex u otros agentes de Orca no reportan costo por sesión, así
  que no entran en la cuenta.
- Si Orca corre contra otro host/OS, la ruta a `service.json` puede ser distinta; se puede forzar
  con la variable de entorno `ORCA_DAILY_BUDGET_SERVICE_FILE`.
