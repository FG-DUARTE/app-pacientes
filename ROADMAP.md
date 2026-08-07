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
