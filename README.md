# ­ƒÆ░ opencode-daily-budget

Plugin de [OpenCode](https://opencode.ai) que pone un **tope de gasto diario** y muestra un widget de consumo visible todo el tiempo:

```
­ƒÆ░ $0.42 / $3.00 hoy
```

- **Bloqueo real**: cuando el gasto del d├¡a alcanza el l├¡mite, el plugin rechaza el env├¡o de nuevos prompts (el contador se reinicia despu├®s de medianoche, hora local).
- **Widget en el footer**: gris (normal), ├ímbar (ÔëÑ 50 % del l├¡mite), rojo (l├¡mite alcanzado). Aparece en la pantalla de inicio y dentro de las sesiones.
- **Clickeable**: haz clic en el widget (o usa `/limite`) para cambiar el l├¡mite al instante, sin reiniciar.
- **Comando `/costo`**: muestra hoy / este mes / hist├│rico.
- **Sobrevive reinicios**: al arrancar reconstruye el gasto del d├¡a enumerando tus sesiones; adem├ís persiste el contador en el storage del plugin.
- **Cuenta por delta**: suma el costo nuevo de cada mensaje en streaming (no duplica por updates acumulativos).

## Requisitos

- OpenCode con soporte de plugins V2 (`@opencode/plugin`).
- Funciona con los modelos de OpenCode Console, que reportan el costo real (`cost` en USD) por mensaje.

> ÔÜá´©Å Si usas proveedores propios (Anthropic API, OpenRouter, etc.) que no reportan costo en la cuenta local de OpenCode, este plugin no puede medir ese gasto.

## Instalaci├│n

### 1. Copia la carpeta del plugin

Clona este repo y copia la carpeta `plugins/daily-budget` a tu directorio de configuraci├│n de OpenCode:

**Linux / macOS:**

```bash
git clone https://github.com/sabandijabot/opencode-daily-budget.git
mkdir -p ~/.config/opencode/plugins
cp -r opencode-daily-budget/plugins/daily-budget ~/.config/opencode/plugins/
```

**Windows (PowerShell):**

```powershell
git clone https://github.com/sabandijabot/opencode-daily-budget.git
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\opencode\plugins" | Out-Null
Copy-Item -Recurse -Force .\plugins\daily-budget "$env:USERPROFILE\.config\opencode\plugins\"
```

### 2. Reg├¡stralo en `opencode.jsonc`

Edita `~/.config/opencode/opencode.jsonc` (en Windows: `C:\Users\USUARIO\.config\opencode\opencode.jsonc`) y agrega:

```jsonc
{
  // ... tu configuraci├│n existente ...
  "plugins": [
    { "package": "./plugins/daily-budget", "options": { "dailyLimit": 3 } }
  ]
}
```

- `dailyLimit` es el **tope diario en USD** (default: `3`). Solo aplica como valor inicial; si luego cambias el l├¡mite con el clic o `/limite`, ese override guardado tiene prioridad.
- La ruta `./plugins/daily-budget` es relativa al directorio de configuraci├│n de OpenCode.

### 3. Reinicia OpenCode

Al arrancar ver├ís en la consola:

```
[daily-budget] activo ÔÇö l├¡mite diario $3.00
```

y el widget `­ƒÆ░ $0.00 / $3.00 hoy` en el footer.

## Uso

| Acci├│n | Resultado |
|---|---|
| Widget del footer | Muestra `$gastado / $l├¡mite hoy`, con color seg├║n el nivel |
| Clic en el widget | Abre un di├ílogo para cambiar el l├¡mite diario |
| `/costo` (alias `/gasto`) | Detalle: hoy, este mes, hist├│rico |
| `/limite` (alias `/limit`) | Cambia el l├¡mite diario sin tocar el config |
| Llegar al l├¡mite | Los prompts nuevos se bloquean con un mensaje explicativo |

## C├│mo funciona (internamente)

- El plugin de **servidor** (`index.ts`) se suscribe al stream de eventos (`message.updated`) y acumula el campo `cost` de cada mensaje **por delta** (costo nuevo ÔêÆ ├║ltimo costo visto), para que las actualizaciones acumulativas del streaming no cuenten dos veces.
- Cada mensaje se atribuye al d├¡a calendario local de su creaci├│n. Caso borde: un mensaje creado justo antes de medianoche que sigue generando despu├®s cuenta para el d├¡a de su creaci├│n.
- En fr├¡o (arranque) reconstruye el total del d├¡a consultando la API de sesiones/mensajes, y persiste el contador en `ctx.storage` como respaldo.
- El bloqueo se hace en el hook de admisi├│n de prompts (`session.hook("prompt")`): si el hook lanza error, OpenCode no admite el prompt.
- El plugin de **TUI** (`tui.tsx`) consulta el consumo v├¡a un **RPC** (`rpc.ts` define el contrato: `usage` y `setLimit` + evento `updated`) y pinta el widget y los comandos.

## Estructura

```
plugins/daily-budget/
Ôö£ÔöÇÔöÇ index.ts   # contabilidad, bloqueo de prompts y RPC (usage / setLimit)
Ôö£ÔöÇÔöÇ rpc.ts     # contrato RPC compartido (schemas)
ÔööÔöÇÔöÇ tui.tsx    # widget del footer, /costo, /limite
```

## Licencia

MIT ÔÇö ver [LICENSE](LICENSE).
