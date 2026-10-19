-- =============================================================================
-- Cupo de favores — Fase 4 (reglas temporales en PostgreSQL)
-- Proyecto: app-pacientes
--
-- Zona horaria operativa documentada: Europe/Madrid
--   La «fecha de hoy» para DELETE y bloqueo de cambio de study_date se calcula
--   en el servidor con timezone('Europe/Madrid', now())::date.
--   La UI del calendario usa la fecha local del navegador (Fase 3); en uso
--   habitual (España) coincide con Madrid. Usuarios en otras zonas pueden ver
--   un desfase de un día respecto al servidor en el límite de medianoche.
--
-- NO ejecutar automáticamente desde CI/agentes. Aplicar manualmente en Supabase
-- (SQL Editor o `supabase db push`) y validar con supabase/tests/favor-temporal-rules.mjs
--
-- Idempotencia: CREATE OR REPLACE + DROP POLICY/TRIGGER IF EXISTS
-- =============================================================================

BEGIN;

-- ─── Fecha «hoy» operativa (Europe/Madrid) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.favor_operative_date_madrid()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT (pg_catalog.timezone('Europe/Madrid', pg_catalog.now()))::date;
$$;

COMMENT ON FUNCTION public.favor_operative_date_madrid() IS
  'Fecha calendario actual en Europe/Madrid para reglas de favor_entries (Fase 4).';

REVOKE ALL ON FUNCTION public.favor_operative_date_madrid() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.favor_operative_date_madrid() FROM anon;

-- ─── UPDATE: impedir cambiar study_date en favores de hoy o pasados ──────────

CREATE OR REPLACE FUNCTION public.favor_entries_enforce_study_date_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  op_date date;
BEGIN
  IF NEW.study_date IS DISTINCT FROM OLD.study_date THEN
    op_date := public.favor_operative_date_madrid();
    IF OLD.study_date <= op_date THEN
      RAISE EXCEPTION
        'favor_entries.study_date no puede modificarse para favores con fecha de hoy o anterior (referencia Europe/Madrid)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.favor_entries_enforce_study_date_rules() IS
  'Trigger Fase 4: solo favores con study_date futura (respecto a Madrid) pueden cambiar de fecha.';

REVOKE ALL ON FUNCTION public.favor_entries_enforce_study_date_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.favor_entries_enforce_study_date_rules() FROM anon;

DROP TRIGGER IF EXISTS favor_entries_enforce_study_date_rules ON public.favor_entries;

CREATE TRIGGER favor_entries_enforce_study_date_rules
  BEFORE UPDATE ON public.favor_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.favor_entries_enforce_study_date_rules();

-- ─── DELETE: solo favores propios con study_date estrictamente futura ────────
-- Sustituye favor_entries_delete_own (Fase 0) sin debilitar aislamiento por user_id.

DROP POLICY IF EXISTS favor_entries_delete_own ON public.favor_entries;

CREATE POLICY favor_entries_delete_own
  ON public.favor_entries
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND study_date > public.favor_operative_date_madrid()
  );

COMMENT ON POLICY favor_entries_delete_own ON public.favor_entries IS
  'Fase 4: borrado solo de favores propios con study_date posterior a hoy (Europe/Madrid).';

-- SELECT / INSERT / UPDATE own: sin cambios (Fase 0). Los demás campos de
-- favores históricos siguen siendo editables vía UPDATE sin tocar study_date.

COMMIT;
