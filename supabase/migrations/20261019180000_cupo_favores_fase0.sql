-- =============================================================================

-- Cupo de favores — Fase 0 (esquema + RLS + privilegios)

-- Proyecto: app-pacientes

--

-- REVISAR antes de ejecutar en Supabase (SQL Editor o CLI).

-- No modifica tablas existentes (patients, patient_actions, notes, actas, …).

--

-- Idempotencia (alcance real):

--   • CREATE TABLE IF NOT EXISTS: si la tabla ya existe, NO comprueba columnas,

--     CHECK ni FK. Una tabla previa con esquema distinto NO se corrige ni falla;

--     el script sigue y puede dejar un esquema divergente sin avisar.

--   • CREATE INDEX IF NOT EXISTS: omite si el índice ya existe (mismo nombre).

--   • DROP POLICY / DROP TRIGGER IF EXISTS + CREATE: reemplaza políticas y triggers

--     del módulo de forma repetible.

--   • CREATE OR REPLACE FUNCTION: sustituye el cuerpo de funciones del módulo.

-- Primera ejecución en BD limpia: crea el esquema completo de forma segura.

-- Re-ejecución tras cambios de CHECK/columnas: puede requerir migración ALTER

-- dedicada; no confiar en IF NOT EXISTS para detectar conflictos de esquema.

-- =============================================================================



BEGIN;



-- ─── Función del módulo: updated_at (no genérica; no reutilizar en otras tablas) ─



CREATE OR REPLACE FUNCTION public.favor_set_updated_at()

RETURNS TRIGGER

LANGUAGE plpgsql

SECURITY INVOKER

SET search_path = pg_catalog, public

AS $$

BEGIN

  NEW.updated_at := pg_catalog.timezone('utc', pg_catalog.now());

  RETURN NEW;

END;

$$;



COMMENT ON FUNCTION public.favor_set_updated_at() IS

  'Trigger Cupo de favores: asigna updated_at en UTC antes de UPDATE en favor_*.';



REVOKE ALL ON FUNCTION public.favor_set_updated_at() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.favor_set_updated_at() FROM anon;



-- ─── Tabla: favor_settings (1 fila por usuario) ─────────────────────────────



CREATE TABLE IF NOT EXISTS public.favor_settings (

  user_id       UUID        PRIMARY KEY

                REFERENCES auth.users (id) ON DELETE CASCADE,

  weekly_quota  SMALLINT    NOT NULL DEFAULT 4

                CONSTRAINT favor_settings_weekly_quota_range

                  CHECK (weekly_quota BETWEEN 1 AND 20),

  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())

);



COMMENT ON TABLE public.favor_settings IS

  'Cupo semanal de favores por usuario autenticado (1–20, default 4).';

COMMENT ON COLUMN public.favor_settings.weekly_quota IS

  'Plazas de favor permitidas por semana calendario (lunes–domingo), según study_date en favor_entries.';



-- ─── Tabla: favor_entries ───────────────────────────────────────────────────



CREATE TABLE IF NOT EXISTS public.favor_entries (

  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id         UUID        NOT NULL

                  REFERENCES auth.users (id) ON DELETE CASCADE,

  study_date      DATE        NOT NULL,

  modality        TEXT        NOT NULL

                  CONSTRAINT favor_entries_modality_allowed CHECK (

                    modality IN ('TC', 'RM', 'Ecografía', 'Rx', 'Mamografía', 'Otro')

                  ),

  modality_other  TEXT        NULL,

  patient_ref     TEXT        NOT NULL,

  requester       TEXT        NOT NULL,

  note            TEXT        NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),



  CONSTRAINT favor_entries_patient_ref_nonempty CHECK (

    char_length(btrim(patient_ref)) >= 1

    AND char_length(patient_ref) <= 32

  ),

  CONSTRAINT favor_entries_requester_nonempty CHECK (

    char_length(btrim(requester)) >= 1

    AND char_length(requester) <= 120

  ),

  CONSTRAINT favor_entries_note_length CHECK (

    note IS NULL OR char_length(note) <= 500

  ),

  CONSTRAINT favor_entries_modality_other_length CHECK (

    modality_other IS NULL OR char_length(modality_other) <= 80

  ),

  CONSTRAINT favor_entries_modality_other_only_for_otro CHECK (

    modality = 'Otro' OR modality_other IS NULL

  )

);



COMMENT ON TABLE public.favor_entries IS

  'Registro de favores (adelantos de estudios). Cuenta por study_date, no por created_at.';

COMMENT ON COLUMN public.favor_entries.patient_ref IS

  'Iniciales o código breve. La UI advierte no usar HC; no hay validación regex en BD.';

COMMENT ON COLUMN public.favor_entries.modality_other IS

  'Descripción opcional cuando modality = Otro.';



-- Índice para listados y agregados semanales por usuario

CREATE INDEX IF NOT EXISTS favor_entries_user_study_date_idx

  ON public.favor_entries (user_id, study_date);



-- Impedir cambiar user_id en UPDATE (defensa en profundidad junto a RLS)

CREATE OR REPLACE FUNCTION public.favor_entries_prevent_user_id_change()

RETURNS TRIGGER

LANGUAGE plpgsql

SECURITY INVOKER

SET search_path = pg_catalog, public

AS $$

BEGIN

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN

    RAISE EXCEPTION 'favor_entries.user_id no puede modificarse';

  END IF;

  RETURN NEW;

END;

$$;



COMMENT ON FUNCTION public.favor_entries_prevent_user_id_change() IS

  'Trigger Cupo de favores: impide reasignar favor_entries a otro user_id.';



REVOKE ALL ON FUNCTION public.favor_entries_prevent_user_id_change() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.favor_entries_prevent_user_id_change() FROM anon;



DROP TRIGGER IF EXISTS favor_settings_set_updated_at ON public.favor_settings;

CREATE TRIGGER favor_settings_set_updated_at

  BEFORE UPDATE ON public.favor_settings

  FOR EACH ROW

  EXECUTE FUNCTION public.favor_set_updated_at();



DROP TRIGGER IF EXISTS favor_entries_set_updated_at ON public.favor_entries;

CREATE TRIGGER favor_entries_set_updated_at

  BEFORE UPDATE ON public.favor_entries

  FOR EACH ROW

  EXECUTE FUNCTION public.favor_set_updated_at();



DROP TRIGGER IF EXISTS favor_entries_prevent_user_id_change ON public.favor_entries;

CREATE TRIGGER favor_entries_prevent_user_id_change

  BEFORE UPDATE ON public.favor_entries

  FOR EACH ROW

  EXECUTE FUNCTION public.favor_entries_prevent_user_id_change();



-- ─── Row Level Security ─────────────────────────────────────────────────────



ALTER TABLE public.favor_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.favor_entries ENABLE ROW LEVEL SECURITY;



-- favor_settings

DROP POLICY IF EXISTS favor_settings_select_own ON public.favor_settings;

CREATE POLICY favor_settings_select_own

  ON public.favor_settings

  FOR SELECT

  TO authenticated

  USING (user_id = auth.uid());



DROP POLICY IF EXISTS favor_settings_insert_own ON public.favor_settings;

CREATE POLICY favor_settings_insert_own

  ON public.favor_settings

  FOR INSERT

  TO authenticated

  WITH CHECK (user_id = auth.uid());



DROP POLICY IF EXISTS favor_settings_update_own ON public.favor_settings;

CREATE POLICY favor_settings_update_own

  ON public.favor_settings

  FOR UPDATE

  TO authenticated

  USING (user_id = auth.uid())

  WITH CHECK (user_id = auth.uid());



DROP POLICY IF EXISTS favor_settings_delete_own ON public.favor_settings;

CREATE POLICY favor_settings_delete_own

  ON public.favor_settings

  FOR DELETE

  TO authenticated

  USING (user_id = auth.uid());



-- favor_entries

DROP POLICY IF EXISTS favor_entries_select_own ON public.favor_entries;

CREATE POLICY favor_entries_select_own

  ON public.favor_entries

  FOR SELECT

  TO authenticated

  USING (user_id = auth.uid());



DROP POLICY IF EXISTS favor_entries_insert_own ON public.favor_entries;

CREATE POLICY favor_entries_insert_own

  ON public.favor_entries

  FOR INSERT

  TO authenticated

  WITH CHECK (user_id = auth.uid());



DROP POLICY IF EXISTS favor_entries_update_own ON public.favor_entries;

CREATE POLICY favor_entries_update_own

  ON public.favor_entries

  FOR UPDATE

  TO authenticated

  USING (user_id = auth.uid())

  WITH CHECK (user_id = auth.uid());



DROP POLICY IF EXISTS favor_entries_delete_own ON public.favor_entries;

CREATE POLICY favor_entries_delete_own

  ON public.favor_entries

  FOR DELETE

  TO authenticated

  USING (user_id = auth.uid());



-- ─── Privilegios: solo rol authenticated ─────────────────────────────────────

-- Supabase expone anon y authenticated. Sin políticas para anon ⇒ sin acceso

-- aunque existiera GRANT (RLS deny-by-default). Revocamos GRANT explícito a anon.



REVOKE ALL ON TABLE public.favor_settings FROM anon;

REVOKE ALL ON TABLE public.favor_entries FROM anon;



GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.favor_settings TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.favor_entries TO authenticated;



-- service_role y postgres bypass RLS (administración Supabase); no usar en frontend.

-- Funciones trigger: REVOKE EXECUTE a PUBLIC/anon; sin GRANT a authenticated (triggers del owner).



COMMIT;


