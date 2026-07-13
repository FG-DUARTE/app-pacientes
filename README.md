# Base de Registros (app-pacientes)

Aplicación para gestionar registros de pacientes y sus actuaciones. Permite crear registros, asignar actuaciones con estados, subir fotos (incluido QR desde móvil), OCR de documentos y notas sueltas.

## Arquitectura puente

El proyecto usa una **arquitectura puente** entre HTML estático y Next.js:

| Capa | Ubicación | Rol |
|------|-----------|-----|
| **App principal** | `public/app.html` | Toda la UI y lógica de negocio (HTML/CSS/JS vanilla) |
| **Subida QR móvil** | `public/upload.html` | Página mínima para subir fotos escaneando QR |
| **Next.js** | `app/`, `lib/` | Servidor local, rutas API, futuras integraciones |
| **PWA** | `public/manifest.json` + iconos | Instalable en móvil y escritorio |

Next.js **no reemplaza** la app principal. Sirve como capa de soporte: `npm run dev`, endpoint keepalive, y base para futuras APIs.

## Cómo arrancar

```powershell
npm install
npm run dev
```

Abrir en el navegador:

- **http://localhost:3000/** — carga `app.html` vía iframe en `app/page.tsx`
- **http://localhost:3000/app.html** — acceso directo a la app principal

## Estructura de carpetas

```
app-pacientes/
├── app/                      # Next.js App Router (capa soporte)
│   ├── api/keepalive/        # GET /api/keepalive — anti-pausa Supabase
│   ├── layout.tsx            # Metadata y layout del shell Next
│   ├── page.tsx              # Redirige visualmente a app.html (iframe)
│   └── test-db/              # Página de prueba Supabase (dev)
├── lib/
│   └── supabase/client.ts    # Cliente Supabase para rutas Next
├── public/                   # Archivos estáticos servidos en /
│   ├── app.html              # ★ App principal
│   ├── upload.html           # Subida por QR
│   ├── manifest.json         # PWA
│   ├── icon-192.png          # Icono PWA
│   ├── icon-512.png          # Icono PWA
│   └── apple-touch-icon.png  # Icono iOS
├── _backups_local/           # Backups locales (gitignored)
├── vercel.json               # Redirige / → /app.html
├── NOTAS.md                  # Documentación técnica y de negocio
└── AGENTS.md                 # Reglas para agentes de IA
```

### Candidatos a eliminar (futuro)

Boilerplate de `create-next-app` sin uso actual:

- `public/file.svg`
- `public/vercel.svg`
- `public/window.svg`

## Deploy en Vercel

1. Conectar el repositorio de GitHub a Vercel.
2. Vercel detecta Next.js automáticamente (`npm run build`).
3. `vercel.json` redirige `/` → `/app.html`.
4. Variables de entorno opcionales en Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Si no se configuran, el endpoint keepalive usa las credenciales embebidas (mismas que en producción).

## Keepalive / UptimeRobot

Supabase pausa la base de datos tras inactividad. Para evitarlo:

- **Endpoint:** `GET /api/keepalive` (App Router en `app/api/keepalive/route.ts`)
- **UptimeRobot:** ping cada 8 horas a `https://tu-dominio.vercel.app/api/keepalive`
- **Función:** consulta la tabla `app_health` en Supabase y devuelve `{ ok: true, data }`

## Iconos PWA

Referencias en `manifest.json` y `app.html`:

- `/icon-192.png` ✓ presente en `public/`
- `/icon-512.png` ✓ presente en `public/`
- `/apple-touch-icon.png` ✓ presente en `public/`

## Documentación adicional

Ver `NOTAS.md` para tablas Supabase, flujos QR/OCR, decisiones de arquitectura y comandos git.
