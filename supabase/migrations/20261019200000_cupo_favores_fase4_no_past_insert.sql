-- =============================================================================
-- Cupo de favores — Fase 4 corrección: prohibir INSERT con fecha pasada
-- Proyecto: app-pacientes
--
-- Requiere: favor_operative_date_madrid() (migración 20261019193000_…).
-- Zona horaria operativa: Europe/Madrid (misma función que DELETE/UPDATE fecha).
--
-- Reglas INSERT:
--   study_date >= hoy Madrid  → permitido (hoy y futuro)
--   study_date <  hoy Madrid  → rechazado por RLS
--
-- No afecta SELECT ni UPDATE de filas históricas ya existentes.
-- NO ejecutar automáticamente; aplicar manualmente en Supabase.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS favor_entries_insert_own ON public.favor_entries;

CREATE POLICY favor_entries_insert_own
  ON public.favor_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND study_date >= public.favor_operative_date_madrid()
  );

COMMENT ON POLICY favor_entries_insert_own ON public.favor_entries IS
  'Fase 4: alta solo con study_date de hoy (Madrid) o futura; sin altas retroactivas.';

COMMIT;
