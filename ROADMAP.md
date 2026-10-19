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

### Fase 2 — cupo semanal individual ✅ (implementada y validada manualmente)

- **UI:** control «Cupo semanal» [−] valor [+] (1–20; botones deshabilitados en límites).
- **Persistencia:** `favor_settings.weekly_quota` por usuario (RLS); default **4** sin fila; **upsert** en autosave al modificar.
- **Cola de guardado:** `saveChain` + `pendingSaveValue` — escrituras serializadas; el último valor pulsado es el que persiste en Supabase.
- **UX:** carga, «Guardando…», «Guardado» breve; en error, restauración al último valor confirmado en BD.
- **Independencia:** cada usuario ve y guarda solo su cupo (`user_id` de sesión).
- **Arquitectura:** lógica en `public/cupo-favores.js`; estilos stepper en `app.html`; sin `isDirty` / burbuja de pacientes.
- **Validación manual (usuario):**
  1. Modificar cupo, recargar → persiste OK.
  2. Dos usuarios con cupos distintos → OK.
  3. Límites 1 y 20 → OK.
  4. Pulsaciones rápidas → último valor coherente con Supabase → OK.
- **Pendiente:** prueba de fallo de red (mensaje + restauración).

### Fase 3 — calendario mensual ✅ (implementada y validada manualmente)

- **Diseño:** cuadrícula mensual lun–dom; días de meses adyacentes atenuados; navegación ‹ › y «Hoy»; día actual seleccionado al abrir.
- **Contadores superiores:** semana del **día seleccionado** (lun–dom): Utilizados / Disponibles / Exceso.
- **Indicadores por fila semanal:** `N/cupo favores` (disponible / completo / excedido).
- **Datos:** `favor_entries` por `study_date`; rango de cuadrícula visible; fechas locales; anti-respuestas obsoletas.
- **Detalle del día:** listado read-only; sin CRUD (reservado Fase 4).
- **Validación manual (usuario):** calendario, contadores, navegación y detalle — satisfactorio.

### Fase 4 — gestión de favores ✅ (implementada y validada)

- **Alta / edición / eliminación** en `public/cupo-favores.js`; estilos en `public/app.html`.
- **Reglas (Europe/Madrid):** crear solo hoy o futuro; editar datos en pasado/hoy/futuro; cambiar fecha solo en futuros; eliminar hoy y futuros; pasado no eliminable.
- **UX:** modal fecha **DD/MM/AAAA** + calendario nativo auxiliar; mensajes comprensibles (sin errores RLS crudos); autocompletado de solicitante.
- **Migraciones SQL** (aplicadas en Supabase producción, también en repo):
  1. `20261019193000_cupo_favores_fase4_temporal_rules.sql`
  2. `20261019200000_cupo_favores_fase4_no_past_insert.sql`
  3. `20261019213000_cupo_favores_fase4_delete_today.sql`
- **Pruebas automatizadas:** `supabase/tests/favor-temporal-rules.mjs` — **11/11 OK** (usuario, cierre Fase 4). `rls-favor-isolation.mjs` sin regresión.
- **Validación manual (usuario):** eliminación hoy/futuro, formulario DD/MM/AAAA, mensajes de error — satisfactorio.
- **Build:** `npm run build` OK en cierre de fase.
- **Históricos:** favores pasados visibles y editables; no eliminables.
- **Futuro (no implementado):** historial y estadísticas avanzadas.

### Próxima fase — 5

- Alertas de cupo completo, respuesta automática para solicitantes.
