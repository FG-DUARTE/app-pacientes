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
