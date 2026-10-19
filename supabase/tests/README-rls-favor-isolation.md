# Prueba de aislamiento RLS — Cupo de favores

Script independiente de la app (`public/app.html`). Verifica que dos usuarios autenticados no puedan leer ni modificar datos del otro en `favor_settings` y `favor_entries`.

**No usa `service_role`.** Solo clave anon/publishable del proyecto + login email/contraseña de dos cuentas reales.

## Requisitos previos

- Migración Fase 0 ejecutada (tablas + 8 políticas RLS).
- Node.js 18+ en el equipo.
- Dependencias del repo instaladas (`npm install` — incluye `@supabase/supabase-js`).
- Dos usuarios distintos que puedan iniciar sesión en la app.

## Variables de entorno

**Nunca commitear contraseñas.** Usar solo en la terminal local.

| Variable | Descripción |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_URL` | URL del proyecto (p. ej. desde `.env.local`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` o `SUPABASE_ANON_KEY` | Clave publishable/anon |
| `RLS_TEST_USER_A_EMAIL` | Email usuario A |
| `RLS_TEST_USER_A_PASSWORD` | Contraseña usuario A |
| `RLS_TEST_USER_B_EMAIL` | Email usuario B |
| `RLS_TEST_USER_B_PASSWORD` | Contraseña usuario B |

## Ejecución paso a paso (PowerShell)

Desde la raíz del repo `app-pacientes`:

1. Cargar URL y anon key (sin escribir contraseñas en archivos):

   ```powershell
   cd C:\PROGRAMACION\PROYECTOS\app-pacientes
   # Opcional: leer solo URL/key desde .env.local manualmente en la sesión
   $env:NEXT_PUBLIC_SUPABASE_URL = "https://TU_PROYECTO.supabase.co"
   $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "tu_clave_publishable"
   ```

2. Definir credenciales de prueba **solo en la sesión actual**:

   ```powershell
   $env:RLS_TEST_USER_A_EMAIL = "cuenta-a@ejemplo.com"
   $env:RLS_TEST_USER_A_PASSWORD = "********"
   $env:RLS_TEST_USER_B_EMAIL = "cuenta-b@ejemplo.com"
   $env:RLS_TEST_USER_B_PASSWORD = "********"
   ```

3. Ejecutar el script:

   ```powershell
   node supabase/tests/rls-favor-isolation.mjs
   ```

4. Revisar salida: cada línea `OK` / `FAIL` y el resumen final.

5. Borrar variables sensibles al cerrar la terminal (no persisten en el repo).

**Alternativa Node 20+** (carga `.env.local` solo para URL/key, no para contraseñas de prueba):

```powershell
node --env-file=.env.local supabase/tests/rls-favor-isolation.mjs
```

(Las cuatro variables `RLS_TEST_USER_*` siguen siendo obligatorias en la sesión.)

## Resultados esperados

| Prueba | Resultado esperado |
|--------|-------------------|
| A INSERT `favor_entries` propio | OK |
| A INSERT `favor_entries` con `user_id` de B | FAIL controlado (error PostgREST/RLS) |
| A SELECT entries de B | 0 filas |
| A UPDATE entry propio | OK |
| A UPDATE/DELETE entry de B por `id` | 0 filas o error |
| A SELECT all entries | No incluye el marcador `RLS_TEST_*` creado por B |
| B INSERT entry propio | OK |
| A INSERT `favor_settings` con `user_id` de B | Error |
| A SELECT/UPDATE/DELETE settings de B | 0 filas o error |
| A INSERT/UPDATE settings propio | OK (INSERT si no existía fila; UPDATE noop si ya existía) |
| B INSERT settings con `user_id` de A | Error |

**Éxito global:** exit code `0` y todas las comprobaciones `OK`.

**Fallo:** exit code `1` — revisar políticas RLS o GRANTs; no marcar Fase 0 como verificada en ROADMAP.

## Limpieza

Al finalizar (incluso si hay FAIL), el bloque `finally`:

- Borra `favor_entries` creados en la prueba (`patient_ref` = marcador `RLS_TEST_<timestamp>`).
- Borra `favor_settings` **solo** si los insertó el script en esa ejecución.
- **No** borra filas de settings que ya existían; solo restaura `weekly_quota` si se guardó backup (noop en la práctica).

No modifica entradas de favores/settings ajenas a la prueba ni datos de otras tablas.

## Precauciones de seguridad

- No pegar contraseñas en chats, commits ni capturas.
- No añadir `RLS_TEST_*` al repositorio.
- La clave anon es pública por diseño; la seguridad depende de RLS + JWT.
- No usar Dashboard SQL con rol bypass para “comprobar” datos del otro usuario durante esta prueba; invalidaría el propósito.
- Ejecutar en entorno de confianza; el script imprime nombres de prueba, no emails ni UUIDs de usuario.
- Tras la prueba, opcional: comprobar en Supabase Table Editor (como admin) que no quedaron filas con `patient_ref` LIKE `RLS_TEST_%`.

## Tras verificación real

Cuando el script termine con **0 FAIL**, actualizar manualmente `ROADMAP.md`: Fase 0 verificada con fecha y nota breve. Hasta entonces permanece «prueba pendiente».
