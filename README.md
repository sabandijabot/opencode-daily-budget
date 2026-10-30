# 💰 opencode-daily-budget

Plugin de [OpenCode](https://opencode.ai) que pone un **tope de gasto diario** y muestra un widget de consumo visible todo el tiempo:

```
💰 $0.42 / $3.00 hoy
```

- **Bloqueo real**: cuando el gasto del día alcanza el límite, el plugin rechaza el envío de nuevos prompts (el contador se reinicia después de medianoche, hora local).
- **Widget en el footer**: gris (normal), ámbar (≥ 50 % del límite), rojo (límite alcanzado). Aparece en la pantalla de inicio y dentro de las sesiones.
- **Clickeable**: haz clic en el widget (o usa `/limite`) para cambiar el límite al instante, sin reiniciar.
- **Comando `/costo`**: muestra hoy / este mes / histórico.
- **Sobrevive reinicios**: al arrancar reconstruye el gasto del día enumerando tus sesiones; además persiste el contador en el storage del plugin.
- **Cuenta por delta**: suma el costo nuevo de cada mensaje en streaming (no duplica por updates acumulativos).

## Requisitos

- OpenCode con soporte de plugins V2 (`@opencode/plugin`).
- Funciona con los modelos de OpenCode Console, que reportan el costo real (`cost` en USD) por mensaje.

> ⚠️ Si usas proveedores propios (Anthropic API, OpenRouter, etc.) que no reportan costo en la cuenta local de OpenCode, este plugin no puede medir ese gasto.

## Instalación

### 1. Copia la carpeta del plugin

Clona este repo y copia la carpeta `plugins/daily-budget` a tu directorio de configuración de OpenCode:

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

### 2. Regístralo en `opencode.jsonc`

Edita `~/.config/opencode/opencode.jsonc` (en Windows: `C:\Users\USUARIO\.config\opencode\opencode.jsonc`) y agrega:

```jsonc
{
  // ... tu configuración existente ...
  "plugins": [
    { "package": "./plugins/daily-budget", "options": { "dailyLimit": 3 } }
  ]
}
```

- `dailyLimit` es el **tope diario en USD** (default: `3`). Solo aplica como valor inicial; si luego cambias el límite con el clic o `/limite`, ese override guardado tiene prioridad.
- La ruta `./plugins/daily-budget` es relativa al directorio de configuración de OpenCode.

### 3. Reinicia OpenCode

Al arrancar verás en la consola:

```
[daily-budget] activo — límite diario $3.00
```

y el widget `💰 $0.00 / $3.00 hoy` en el footer.

## Uso

| Acción | Resultado |
|---|---|
| Widget del footer | Muestra `$gastado / $límite hoy`, con color según el nivel |
| Clic en el widget | Abre un diálogo para cambiar el límite diario |
| `/costo` (alias `/gasto`) | Detalle: hoy, este mes, histórico |
| `/limite` (alias `/limit`) | Cambia el límite diario sin tocar el config |
| Llegar al límite | Los prompts nuevos se bloquean con un mensaje explicativo |

## Cómo funciona (internamente)

- El plugin de **servidor** (`index.ts`) se suscribe al stream de eventos (`message.updated`) y acumula el campo `cost` de cada mensaje **por delta** (costo nuevo − último costo visto), para que las actualizaciones acumulativas del streaming no cuenten dos veces.
- Cada mensaje se atribuye al día calendario local de su creación. Caso borde: un mensaje creado justo antes de medianoche que sigue generando después cuenta para el día de su creación.
- En frío (arranque) reconstruye el total del día consultando la API de sesiones/mensajes, y persiste el contador en `ctx.storage` como respaldo.
- El bloqueo se hace en el hook de admisión de prompts (`session.hook("prompt")`): si el hook lanza error, OpenCode no admite el prompt.
- El plugin de **TUI** (`tui.tsx`) consulta el consumo vía un **RPC** (`rpc.ts` define el contrato: `usage` y `setLimit` + evento `updated`) y pinta el widget y los comandos.

## Estructura

```
plugins/daily-budget/
├── index.ts   # contabilidad, bloqueo de prompts y RPC (usage / setLimit)
├── rpc.ts     # contrato RPC compartido (schemas)
└── tui.tsx    # widget del footer, /costo, /limite
```

## Licencia

MIT — ver [LICENSE](LICENSE).
