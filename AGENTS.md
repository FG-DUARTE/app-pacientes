<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Reglas del proyecto — Base de Registros

## Arquitectura puente

- **App principal:** `public/app.html` — HTML/CSS/JS vanilla con toda la lógica de negocio.
- **Next.js:** capa de soporte — servidor local (`npm run dev`), rutas API (`app/api/`), futuras integraciones.
- **NO migrar la UI a React** salvo decisión explícita del usuario.
- **NO tocar la lógica funcional** en `public/app.html` ni `public/upload.html` salvo petición explícita.

## Qué puedes modificar en Next.js

- `app/api/` — endpoints de soporte (p. ej. keepalive).
- `app/layout.tsx` — metadata y layout del shell Next (no es la app principal).
- `app/page.tsx` — iframe que carga `app.html` en `/`.
- `lib/` — utilidades compartidas (p. ej. cliente Supabase para rutas Next).
- Documentación: `README.md`, `NOTAS.md`, este archivo.

## Qué NO tocar sin petición explícita

- `public/app.html` — lógica de pacientes, actuaciones, auth, OCR, QR, etc.
- `public/upload.html` — flujo de subida por QR desde móvil.
- Tablas Supabase, políticas RLS, Edge Functions.
- Claves/credenciales embebidas en `app.html` (son las de producción del cliente).

## Convenciones Next.js 16

- Usar App Router (`app/`) para rutas y API handlers (`route.ts`).
- Las reglas de Next.js 16 anteriores siguen aplicando para todo código en `app/` y `lib/`.
- Consultar `node_modules/next/dist/docs/` antes de usar APIs de Next.js.

## Backups locales

- Carpeta `_backups_local/` en raíz — gitignored, para archivos de respaldo locales.
- No borrar archivos del repo sin listarlos y justificarlos.
