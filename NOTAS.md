# NOTAS DEL PROYECTO — Base de Registros

## Stack
- **Frontend principal:** HTML/CSS/JS vanilla en `public/app.html` (app completa)
- **Capa soporte:** Next.js 16 (App Router) — servidor local, API routes, futuras integraciones
- **Base de datos:** Supabase (PostgreSQL)
- **Storage:** Supabase Storage — bucket `archivos`
- **Auth:** Supabase Auth (email + password)
- **Deploy:** Vercel (auto-deploy desde GitHub)
- **Repo:** GitHub (rama `main`)
- **Editor:** VSCode / Cursor
- **OCR:** Tesseract.js v5 (corre en el navegador, sin servidor)
- **QR:** qrcodejs (CDN cloudflare)
- **Edge Functions:** Supabase Edge Functions (Deno)

---

## Arquitectura puente

La app principal vive en `public/app.html`. Next.js actúa como **capa puente**:

- `npm run dev` → servidor local en http://localhost:3000
- `/` → iframe a `app.html` (vía `app/page.tsx`) o redirección en Vercel
- `/app.html` → acceso directo a la app
- `/api/keepalive` → endpoint App Router para UptimeRobot
- `lib/supabase/` → cliente Supabase para rutas Next (no usado por app.html)

**No migrar la UI a React** sin decisión explícita. La lógica de negocio permanece en HTML vanilla.

---

## Estructura del proyecto
```
app-pacientes/
  ├── app/                          ← Next.js App Router (capa soporte)
  │     ├── api/keepalive/route.ts  ← GET /api/keepalive (anti-pausa Supabase)
  │     ├── layout.tsx              ← metadata del shell Next
  │     ├── page.tsx                ← iframe a app.html en /
  │     └── test-db/                ← prueba conexión Supabase (dev)
  ├── lib/
  │     └── supabase/client.ts      ← cliente Supabase para rutas Next
  ├── public/
  │     ├── app.html                ← ★ app principal (toda la lógica)
  │     ├── upload.html             ← página mini para subir fotos por QR desde móvil
  │     ├── manifest.json           ← PWA
  │     ├── icon-192.png            ← icono PWA (192×192)
  │     ├── icon-512.png            ← icono PWA (512×512)
  │     └── apple-touch-icon.png    ← icono iOS
  ├── _backups_local/               ← backups locales (gitignored)
  ├── vercel.json                   ← redirige / a /app.html
  ├── NOTAS.md                      ← este archivo
  ├── README.md                     ← guía de arranque y arquitectura
  └── AGENTS.md                     ← reglas para agentes de IA
```

### Boilerplate sin uso (candidatos a eliminar futura)
- `public/file.svg`, `public/vercel.svg`, `public/window.svg` — restos de create-next-app

---

## Tablas en Supabase
- **patients** — registros principales (identifier, datos_generales, archived, user_id)
- **patient_actions** — actuaciones por registro (status, note, fecha_limite, foto1_url...foto5_url, patient_id)
- **notes** — notas sueltas (text, is_deleted, user_id)
- **logs** — historial de cambios (type, snapshot, patient_id, user_id)
- **profiles** — nombre y apellido de cada usuario (user_id, nombre, apellido)
- **qr_tokens** — tokens temporales para subir fotos por QR (token, patient_db_id, action_index, expires_at, used_slots)
- **app_health** — tabla simple para el ping de UptimeRobot (id=1, ping=ok)

---

## Storage
- Bucket: `archivos` (público)
- Estructura: `{user_id}/{identificador}/accion_{N}/foto{slot}_{timestamp}.jpg`
- Fotos subidas por QR van a: `{user_id}/{identificador}/accion_{N}/foto{slot}_{timestamp}.jpg`
- Cada usuario accede solo a su carpeta (policy por user_id)

---

## Edge Functions
- **qr-upload** — recibe foto desde móvil, valida token QR, sube al bucket, actualiza patient_actions
  - URL: `https://ubzcboqndsuugszwarls.supabase.co/functions/v1/qr-upload`
  - JWT verification: OFF (el token QR es la seguridad)

---

## Keep-alive (anti-pausa Supabase)
- UptimeRobot hace ping cada 8hs a `/api/keepalive`
- Endpoint App Router: `app/api/keepalive/route.ts` (funciona con `npm run dev` y Vercel)
- Consulta la tabla `app_health` en Supabase
- Usa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` si existen; si no, credenciales embebidas
- Evita que Supabase pause la BD por inactividad
- **Migrado desde** `api/keepalive.js` (formato Vercel serverless legacy, eliminado)

---

## Decisiones de arquitectura importantes

### Sesión
- `persistSession: false`, `autoRefreshToken: false`
- El token vive solo en memoria RAM
- Al cambiar de pestaña el token se mantiene gracias al fix de `onAuthStateChange`
- **Fix clave:** `onAuthStateChange` tiene guard para no resetear si el usuario ya estaba logueado:
  ```js
  if(currentUser && session?.user && currentUser.id === session.user.id) return;
  ```
- Timer de inactividad: 30 minutos, se resetea con cualquier interacción
- Al expirar: muestra login en la misma página sin redirigir

### Estados de actuaciones
- 🔴 Pendiente (`pending`)
- 🟡 Realizado (`done`)
- 🔵 En seguimiento (`followup`)
- 🟣 Varios (`various`)
- 🟢 Integrado/Completado (`integrated`)

### Filtros de lista
- **Activos:** tienen al menos 1 🔴 o 🟡
- **En seguimiento:** tienen 🔵
- **Varios:** tienen 🟣
- **Completados:** todas las actuaciones son 🟢
- **Notas:** muestra notas sueltas
- **Todos:** todos los registros

### Orden de prioridad en lista
1. 🚨 Fecha límite urgente (≤2 días o vencida)
2. ⚠️ Fecha límite próxima (≤5 días)
3. Por color: 🔴 → 🟡 → 🔵 → 🟣
4. Por número de identificador

### Sync de actuaciones
- `syncPatientActionsToDb`: DELETE + INSERT preservando fotos
  - Lee fotos existentes en BD antes de borrar
  - Merge: si el DOM tiene URL la usa, si no preserva la de BD
  - Borra fotos del bucket al eliminar actuaciones

### isUsedAction
- Una actuación se considera "usada" si tiene: status, note, O alguna foto
- Importante: actuaciones QR pueden tener solo fotos (status y note vacíos)

---

## Flujos especiales

### OCR / Escanear documento
1. Usuario sube foto o saca foto del documento
2. Tesseract.js lee el texto buscando NHC, HC, Historia Clínica + número
3. Si encuentra → propone el identificador
4. Usuario confirma → abre registro existente o crea uno nuevo vacío
5. La foto del escaneo NO se guarda (solo sirve para identificar)

### QR upload de fotos
1. Usuario pulsa 📸 en una actuación
2. Se genera QR con token temporal (5 min) apuntando al primer slot libre
3. Móvil escanea → abre `upload.html`
4. Usuario sube 1 foto → Edge Function valida token y guarda en BD
5. PC detecta (polling 3s) → recarga y muestra la foto
6. Modal QR se cierra automáticamente

### Fecha límite
- Campo `fecha_limite` (DATE) en `patient_actions`
- Formato de visualización: dd/mm/aaaa
- Almacenamiento: yyyy-mm-dd (formato nativo HTML date input)
- Alertas: ⚠️ amarillo ≤5 días, 🚨 rojo ≤2 días o vencida
- Badge aparece al lado del número de registro en la lista

---

## PWA
- Instalable en móvil (iOS: Safari → compartir → añadir a inicio) y PC (Chrome: ícono en barra de direcciones)
- `manifest.json` referencia `/icon-192.png` y `/icon-512.png`
- `app.html` referencia `/apple-touch-icon.png` e `/icon-192.png` (logo login)
- Iconos presentes en `public/` y trackeados en git
- `maximum-scale=1, user-scalable=no` para evitar zoom en iOS al enfocar inputs
- `font-size: 16px` en inputs para evitar zoom automático en iOS

---

## Colores del tema
```css
--accent: #2563eb
--danger: #ef4444
--ok: #10b981
--warn: #f59e0b
--info: #3b82f6
--violet: #8b5cf6
--orange: #f97316
--header-bg: #e6f1fb
--left-bg: #eef4ff
--right-bg: #f0f5ff
```

---

## Comandos git frecuentes (PowerShell)
```powershell
git add public/app.html; git commit -m "descripcion"; git push
git tag nombre-backup; git push origin nombre-backup
git checkout nombre-backup -- public/app.html
git log --oneline
```

---

## Problemas resueltos y sus soluciones

| Problema | Solución |
|----------|----------|
| App se cuelga al cambiar pestaña | Guard en `onAuthStateChange` para no resetear si usuario ya logueado |
| Foto QR sobreescribe slot ocupado | Edge Function busca primer slot vacío real en BD |
| Actuaciones QR no se pueden eliminar | Borrado directo en Supabase por ID de fila |
| Validador dice "ya existe" al actualizar | Comparar por `dbId` además de `id` local |
| Botón guardar no responde después de un rato | `onAuthStateChange` reseteaba la app al volver a la pestaña |
| iOS hace zoom al enfocar inputs | `font-size: 16px` en inputs + `maximum-scale=1` en viewport |
