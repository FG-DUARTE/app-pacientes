-- =============================================================================
-- Cupo de favores — Fase 4: permitir DELETE de favores de hoy (Europe/Madrid)
-- Proyecto: app-pacientes
--
-- Requiere: favor_operative_date_madrid() (migración 20261019193000_…).
-- Actualiza solo la política DELETE; INSERT/UPDATE/triggers sin cambios.
--
-- Regla DELETE: study_date >= hoy Madrid (hoy y futuros; pasado prohibido).
-- NO ejecutar automáticamente; aplicar manualmente en Supabase.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS favor_entries_delete_own ON public.favor_entries;

CREATE POLICY favor_entries_delete_own
  ON public.favor_entries
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND study_date >= public.favor_operative_date_madrid()
  );

COMMENT ON POLICY favor_entries_delete_own ON public.favor_entries IS
  'Fase 4: borrado de favores propios con study_date de hoy (Madrid) o futura; pasado prohibido.';

COMMIT;
