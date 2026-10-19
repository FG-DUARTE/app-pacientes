# Supabase — migraciones locales

Scripts SQL versionados para aplicar manualmente en el proyecto Supabase de **app-pacientes** (Dashboard → SQL Editor, o `supabase db push` si más adelante se enlaza CLI).

## Convención

- `migrations/YYYYMMDDHHMMSS_descripcion.sql` — orden cronológico, una entrega por archivo cuando sea posible.
- Revisar el script completo antes de ejecutar en producción.
- **No** incluye credenciales ni `service_role`.

## Idempotencia (Fase 0)

- **`CREATE TABLE IF NOT EXISTS` no valida** tablas ya creadas: columnas, CHECK y FK distintos **no se detectan** en una re-ejecución.
- Políticas y triggers del módulo sí se pueden re-aplicar (`DROP … IF EXISTS` + `CREATE`).
- Funciones del módulo: `favor_set_updated_at()`, `favor_entries_prevent_user_id_change()` — nombres **prefijados**, `search_path` fijo, `SECURITY INVOKER`, `REVOKE EXECUTE` a `PUBLIC`/`anon` (sin `GRANT` a `authenticated`; los triggers los ejecuta el owner de la tabla).
- Pensado para **primera ejecución** en BD sin estas tablas; cambios de esquema posteriores → nueva migración `ALTER`.

## Estado

| Migración | Descripción | Ejecutada en remoto |
|-----------|-------------|---------------------|
| `20261019180000_cupo_favores_fase0.sql` | Tablas `favor_settings`, `favor_entries`, RLS, triggers | Ejecutada |
| *(prueba)* `tests/rls-favor-isolation.mjs` | Aislamiento RLS entre 2 usuarios (anon + JWT) | Pendiente de ejecución |

Ver `tests/README-rls-favor-isolation.md`.
