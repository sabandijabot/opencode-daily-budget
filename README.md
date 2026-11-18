# daily-budget

Tope de gasto diario para **OpenCode**, con dos piezas que comparten el mismo dato:

| Carpeta | Qué es | Dónde se ve |
| --- | --- | --- |
| [`plugins/opencode`](plugins/opencode) | Plugin de OpenCode V2 | Footer de la TUI, `/costo`, `/limite`, **bloqueo de prompts** |
| [`plugins/orca`](plugins/orca) | Plugin de Orca | Barra de estado y panel lateral de Orca |

El plugin de Orca **no duplica** la contabilidad: lee el RPC del plugin de OpenCode
(`/api/rpc/daily-budget/usage`) y usa `setLimit` para cambiar el tope en caliente. Por eso el número
que muestra es exactamente el que aplica el bloqueo.

## Instalar en OpenCode

Copia (o enlaza) `plugins/opencode` en tu config global:

```
~/.config/opencode/plugins/daily-budget/
├── index.ts
├── rpc.ts
└── tui.tsx
```

Y regístralo en `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    { "package": "./plugins/daily-budget", "options": { "dailyLimit": 3 } }
  ]
}
```

Reinicia el TUI (o `opencode service restart`). Detalles en
[`plugins/opencode/README.md`](plugins/opencode/README.md).

## Instalar en Orca

Requiere Orca ≥ 1.4.248 y el plugin de OpenCode ya cargado (es su fuente de datos).

```powershell
orca plugin install <ruta-o-url-del-repo>/plugins/orca
```

En desarrollo, sin publicar:

```powershell
orca plugin dev load "<ruta>\plugins\orca" --approve <fingerprint>
orca plugin open local.daily-budget --panel budget
```

Detalles y desarrollo en [`plugins/orca/README.md`](plugins/orca/README.md).

## Cómo se complementan

- En el **chat de Orca**, la TUI de OpenCode no se dibuja: por eso el plugin de Orca pone el widget
  en la barra de estado y el panel.
- En una **terminal de OpenCode** (dentro o fuera de Orca), el plugin de OpenCode muestra su footer
  y sus comandos.
- El **bloqueo** siempre lo hace OpenCode; el plugin de Orca solo muestra y cambia el tope.

## Licencia

MIT. Ver [LICENSE](LICENSE).
