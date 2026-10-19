# Prueba reglas temporales Fase 4 — favor_entries

Verifica en Supabase (vía API anon + JWT) que:

- No se puede cambiar `study_date` en favores de **hoy o pasados**.
- Solo se pueden **eliminar** favores con `study_date` **estrictamente futura** (referencia `Europe/Madrid` en BD).
- Sigue siendo posible **actualizar** otros campos en favores históricos.

**Requisitos:** migraciones Fase 4 aplicadas en el proyecto (en orden):

- `20261019193000_cupo_favores_fase4_temporal_rules.sql`
- `20261019200000_cupo_favores_fase4_no_past_insert.sql`
- `20261019213000_cupo_favores_fase4_delete_today.sql` (DELETE hoy y futuros)

Opcional para prueba 9 (aislamiento DELETE): `RLS_TEST_USER_B_EMAIL` / `RLS_TEST_USER_B_PASSWORD`.

## Variables de entorno

Igual que `README-rls-favor-isolation.md` (URL, anon key, `RLS_TEST_USER_A_*`). Una sola cuenta basta.

## Ejecución (PowerShell)

```powershell
cd C:\PROGRAMACION\PROYECTOS\app-pacientes
# URL + anon key + RLS_TEST_USER_A_EMAIL / RLS_TEST_USER_A_PASSWORD en la sesión
node supabase/tests/favor-temporal-rules.mjs
```

**Éxito:** exit code `0`.

**Si DELETE/UPDATE de fecha fallan en bloque:** la migración Fase 4 no está aplicada (o hay desfase grave de reloj).

## Limpieza

- Intenta borrar filas creadas en la prueba (`patient_ref` con prefijo `F4_TEST_*`).
- Favores de **pasado/hoy** insertados para probar bloqueos pueden quedar en BD si la migración impide DELETE; borrar manualmente desde SQL Editor como admin si hace falta.

## Datos

Solo valores ficticios (`TC`, referencias `F4_TEST_*`, solicitante «Prueba F4»). No usar datos reales de pacientes.
