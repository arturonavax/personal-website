# Convención de Carpetas: `openspec/specs/` vs `odd/`

## `openspec/specs/` — Especificaciones Técnicas (Inmutables)

- **Propósito**: Source of truth del **qué** y **porqué**. Contratos, requisitos, invariantes, esquemas, matrices DoD.
- **Ciclo de vida**: Inmutables salvo decisión explícita del arquitecto. No se mueven ni se duplican.
- **Contenido**: SPEC-001 a SPEC-007, cada uno con methodology, REQ-*, VAL-*, code blocks, DoD matrices.
- **Regla**: Los specs **nunca** se trasladan a `odd/`. Solo se *leen* desde allí para guiar el trabajo.

## `odd/` — Artefactos de Flujo ODD (Efímeros)

- **Propósito**: Tracking del **cómo** y **cuándo**. Progreso por feature, estado de tarea, handoffs.
- **Ciclo de vida**: Se crean y se borran por feature. Mutables.
- **Estructura por feature**:
  ```
  odd/
  └── <feature-name>/
      ├── README.md     # Flujo ODD de esta feature (opcional)
      └── tasks.md      # Lista de tareas con estado (pending/in_progress/done)
  ```
- **Regla**: Cada feature nueva crea su propio subdirectorio bajo `odd/`. No se comparten tareas entre features.

## Flujo de una Feature Nueva

1. **Explorar** los specs relevantes en `openspec/specs/` (CodeGraph + skills).
2. **Clasificar** si es sustancial → crear `odd/<feature>/tasks.md` antes del primer edit.
3. **Implementar** por tareas, cada una con commit de unidad de trabajo.
4. **Verificar** con tests + gates (`bun run check`, `audit-codebase.ts`, CWV).
5. **Cerrar** con resultado verificado y memoria guardada si es decisión clave.