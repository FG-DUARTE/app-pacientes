# ROADMAP — Base de Registros

## Lista de registros (pacientes)

### Implementado

- **Última modificación visible** en cada tarjeta del panel izquierdo (esquina superior derecha, formato DD/MM/AAAA).
  - Cálculo: `MAX(patients.updated_at, MAX(patient_actions.updated_at))` por registro.
- **Selector de orden** en el área de filtros:
  - Modificación más reciente primero (por defecto, en registros sin alerta de fecha límite).
  - Modificación más antigua primero.
  - ID menor a mayor.
- **Prioridad por fecha límite preservada** en el orden de la lista:
  1. Vencida o ≤ 2 días (urgente).
  2. Próxima ≤ 5 días.
  3. Resto — aquí se aplica el orden seleccionado.
  - Dentro de los grupos urgentes/próximos se mantiene el orden por severidad de color (🔴🟡🔵🟣) e ID.
- **Búsqueda ampliada** con filtro opcional por rango de última modificación:
  - Campos Desde / Hasta (inclusive).
  - Combinable con búsqueda por identificación y texto.
- **Rendimiento**: sin consultas N+1; usa datos ya cargados en memoria (`loadPatientsFromDb`).

### Pendiente / futuro

- Sincronización en tiempo real de fechas tras subida QR sin recargar.
- Migración gradual de UI a React (solo si se decide explícitamente).

## Burbuja flotante de guardado

### Implementado

- **Indicador único** en esquina superior derecha (`#saveBubble`), fijo, forma pill, alta prioridad visual.
- **Estados:**
  - Sin cambios pendientes: burbuja oculta (sin “Guardado” permanente).
  - Cambios sin guardar: naranja/rojo, texto “Cambios sin guardar”, clic → misma función `savePatientForm()` que el antiguo botón “Cambios / Guardar”.
  - Guardando: “Guardando…”, gris/azul, spinner, no permite doble clic.
  - Error: rojo intenso, “Error al guardar”, clic reintenta; detalle en `title`/tooltip; mantiene estado dirty.
  - Éxito: `markClean()` — burbuja desaparece por completo.
- **Dirty tracking reutilizado:** flag `isDirty`, `markDirty()` / `markClean()`, listeners en `setupDirtyListeners()` y llamadas puntuales en actuaciones/fotos — sin segundo sistema de dirty state.
- **Controles retirados:** botón `#btnSave` (“Cambios / Guardar”) e indicador `#autosaveIndicator`.
- **Protección de navegación:**
  - `beforeunload` cuando `isDirty` (no tras guardado exitoso).
  - Cambio de registro (`selectPatient`) y “+ Nuevo” (`btnNew`): confirmación “Tienes cambios sin guardar. Si continúas, se perderán. ¿Quieres continuar?” — cancelar mantiene el registro y los cambios; aceptar descarta y continúa (coherente con `markClean()` al cargar otro registro).

## Cupo de favores

### Decisiones aprobadas

- Módulo accesible para **todos los usuarios autenticados**; datos **aislados por usuario** (RLS en PostgreSQL, no solo filtros JS).
- **Cupo semanal** independiente por usuario: entero **1–20**, predeterminado **4**; tabla `favor_settings`.
- Favores en **`favor_entries`**; la semana cuenta por **`study_date`** (tipo `DATE`), no por `created_at`.
- **`patient_ref`**: iniciales o código breve (máx. 32 caracteres en BD); **sin** validación regex de HC en SQL; la UI advertirá al usuario.
- Modalidad **`Otro`** con descripción opcional (`modality_other`, máx. 80 caracteres).
- **Encabezado dinámico** según sección (Seguimiento de pacientes / Cupo de favores).
- Código del módulo en **archivo JavaScript independiente**, reutilizando sesión y cliente Supabase de `app.html`.
- **No modificar** tablas existentes (`patients`, `patient_actions`, `notes`, `actas`, `profiles`, etc.).

### Fase 0 — base de datos y seguridad ✅ (completada y verificada)

- Migración ejecutada en Supabase; tablas `favor_settings` y `favor_entries`; RLS activo (8 políticas).
- Prueba de aislamiento: `supabase/tests/rls-favor-isolation.mjs` — **16/16 OK** (dos usuarios reales); registros temporales eliminados.
- **Artefactos:** `supabase/migrations/20261019180000_cupo_favores_fase0.sql`, `supabase/README.md`, `supabase/tests/README-rls-favor-isolation.md`.

### Fase 1 — navegación y estructura inicial ✅ (completada y validada manualmente)

- Selector en cabecera (`#appSectionNav`); título dinámico; `#favoresWrap` + `public/cupo-favores.js`.
- Integración `CupoFavores.init({ root, getClient, getUser })` — un solo cliente Supabase y sesión existente.
- Protección dirty: `confirmDiscardIfDirty()` al pasar a favores; burbuja oculta en sección favores; login/logout en sección pacientes.
- **Corrección descarte:** `discardDirtyPatientFormAndRestore()` + `applyPatientToForm()` — restauración desde BD/memoria antes de `markClean()`; si falla, no navega.
- **Validación manual (usuario):** navegación entre secciones, edición de pacientes, protección de cambios sin guardar — satisfactorio.
- **Build:** `npm run build` OK en cierre de fase.

### Arquitectura (decisiones registradas)

- Módulo en JS separado; shell en `app.html` mínimo; sin React; sin `service_role`.
- Privacidad por usuario vía RLS; semana por `study_date`; cupo en `favor_settings` (fase 2).

### Próxima fase — 2

- **Configuración del cupo semanal individual:** valor predeterminado **4**, rango **1–20**, autosave en `favor_settings`, medidor visual.
- Después: CRUD favores, navegación semanal, respuesta automática.
