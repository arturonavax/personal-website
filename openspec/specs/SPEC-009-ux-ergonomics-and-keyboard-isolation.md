# SPEC-009: AISLAMIENTO DE ATAJOS DE TECLADO, ERGONOMÍA DE MODALES Y PULIDO DE MICRO-INTERACCIONES

## Invariantes de Aislamiento de Entradas Editables, Detección Inmediata de Desbordamiento y Eliminación de Indicadores Redundantes

```yaml
id: SPEC-009-UX-ERGONOMICS-AND-INPUT-ISOLATION
title: Keyboard Input Isolation, Modal Ergonomics & Micro-Interaction Polish
status: APPROVED / IMPLEMENTED
version: 1.0.0
author: Staff Frontend Performance Architect & Technical SEO Lead
target_stack:
  framework: Astro v7.3.4+ (Compilación Estática Pura / ClientRouter)
  styling: Tailwind CSS v4.3.3+ (CSS-First @theme Engine / LightningCSS)
  runtime: Cloudflare Edge (Workers Static Assets, 0 KB Baseline Client JS)
  components:
    - src/components/ui/PageIndexNav.astro
    - src/components/ui/ShortcutsModal.astro
    - src/components/ui/CoffeeSponsorshipModal.astro
methodology: Organic/Operational-Driven Development (ODD)
cross_references:
  spec_006: openspec/specs/SPEC-006-ux-editorial-refinements.md
  spec_007: openspec/specs/SPEC-007-frontend-stability-and-ux-polish.md
  spec_008: openspec/specs/SPEC-008-edge-performance-re-architecture-restoration.md
```

---

## 1. Declaración de Problemas y Diagnóstico Causa Raíz

### 1.1. Colisión de Atajos Globales en Superficies Editables (Letras `i` y `p`)

- **Síntoma:** Al escribir en el editor de texto del Resume Maker (`textarea`) o en el cuadro de búsqueda del modal de búsqueda universal (`#universal-search-input`), el usuario no puede escribir los caracteres `i` o `p`.
- **Causa Raíz:** En `src/components/ui/PageIndexNav.astro`, el listener global `document.addEventListener("keydown")` interceptaba `e.key === "i"` y `e.key === "p"` ejecutando `e.preventDefault()`, sin verificar `isInputFocused` ni el estado de modales abiertos. Además, interceptaba combinaciones con modificadores (`Ctrl+I`, `Cmd+I`).
- **Impacto:** Bloqueo crítico de captura de texto en formularios, textareas de generación de CV y campos de búsqueda.

### 1.2. Retraso en el Indicador de Desplazamiento del Modal "Buy Me a Coffee"

- **Síntoma:** El indicador visual "Scroll for more channels" (_Más opciones abajo_) solo aparecía una vez que el usuario comenzaba a desplazarse manualmente, a pesar de que el contenido ya excedía la altura visible al abrir el modal.
- **Causa Raíz:**
  1. En transiciones de navegación SPA (`ClientRouter`), la delegación documental retenía referencias clausuradas a elementos del DOM desvinculados de páginas previas.
  2. La apertura asíncrona de `<dialog>` con `showModal()` ejecuta cálculos de layout en el siguiente frame de composición. Un único `requestAnimationFrame` evaluaba dimensiones antes del recálculo completo de estilos.
  3. Ausencia de `ResizeObserver` y `MutationObserver` vinculados al estado `open` del diálogo.

### 1.3. Indicador Redundante y Contradictorio de "J K scroll" en el Modal de Atajos

- **Síntoma:** El pie del modal de Shortcuts mostraba los keycaps visuales `j` y `k` acompañados de la etiqueta `scroll`.
- **Causa Raíz:** En `src/layouts/BaseLayout.astro`, la navegación Vim (`j`/`k`) se cancela explícitamente cuando cualquier modal está abierto (`dialog[open], [role="dialog"]:not(.hidden)`). Presentar la indicación dentro del modal sugería una funcionalidad inoperante e inducía a confusión.

---

## 2. Requerimientos Arquitectónicos y Soluciones Técnicas

### REQ-UXE-32: Blindaje de Entradas Editables y Aislamiento de Atajos (`PageIndexNav.astro`)

1. **Detección Exhaustiva de Elementos Activos:**
   - La comprobación `isInputFocused` debe evaluar tanto `document.activeElement` como `e.target` frente a etiquetas editables: `INPUT`, `TEXTAREA`, `SELECT` y la propiedad booleana `isContentEditable`.
2. **Aislamiento por Presencia de Modales:**
   - Si existe un diálogo activo (`document.querySelector('dialog[open], [role="dialog"]:not(.hidden)')`), los atajos de teclado (`i`, `p`) quedan estrictamente inhibidos.
3. **Respeto a Modificadores:**
   - Si `e.ctrlKey`, `e.metaKey` o `e.altKey` están activos, el evento se ignora permitiendo los atajos nativos del navegador o del sistema operativo.
4. **Reserva de Tecla Escape:**
   - La tecla `Escape` solo cierra el panel móvil del índice si dicho panel está actualmente visible (`!panel.classList.contains("hidden")`). Si no lo está, delega el control a otros manejadores (como el cierre de modales o desenfoque de inputs).

### REQ-UXE-33: Detección Inmediata y Reactiva de Desbordamiento (`CoffeeSponsorshipModal.astro`)

1. **Resolución Dinámica de Elementos del DOM:**
   - `updateCoffeeScrollHint` consulta dinámicamente `document.getElementById("coffee-dialog-scroll")` y `document.getElementById("coffee-scroll-hint")` para garantizar la compatibilidad con el ciclo de vida de `ClientRouter` en Astro.
2. **Ciclo de Verificación Multietapa:**
   - Al abrir el diálogo (`data-open-coffee-modal` o `#open-coffee-modal-btn`), se desencadena una evaluación inmediata seguida de comprobaciones en `requestAnimationFrame`, `setTimeout(..., 50)` y `setTimeout(..., 150)`.
3. **Reactividad con MutationObserver y ResizeObserver:**
   - `MutationObserver` vigila mutaciones en el atributo `open` de `<dialog id="coffee-sponsorship-dialog">` para activar la comprobación de desbordamiento de forma autónoma.
   - `ResizeObserver` supervisa el contenedor de scroll `#coffee-dialog-scroll` para recalcular el desbordamiento si el tamaño de ventana o el renderizado tipográfico cambian.
   - Evento `resize` en `window` vinculado pasivamente para recálculos en cambios de viewport o zoom.

### REQ-UXE-34: Erradicación de Indicadores Inoperantes (`ShortcutsModal.astro`)

1. **Pie de Diálogo Limpio y Preciso:**
   - Eliminados los keycaps `j` y `k` y el separador de punto en el pie de página de `ShortcutsModal.astro`.
   - Se mantiene exclusivamente la indicación concisa y fidedigna: `Presiona Esc para cerrar` / `Press Esc to close`.
2. **Robustez de Indicador de Desplazamiento:**
   - Añadido `ResizeObserver` al contenedor de cuadrícula de atajos `#shortcuts-grid-scroll` para asegurar visibilidad inmediata del gradiente inferior cuando existe scroll vertical.

---

## 3. Matriz de Verificación y Pruebas Unitarias

```typescript
describe("SPEC-009: Keyboard Input Isolation, Modal Ergonomics & Micro-Interaction Polish", () => {
  // REQ-UXE-32: PageIndexNav input shielding & modal isolation
  // REQ-UXE-33: Coffee modal immediate scroll indicator & observers
  // REQ-UXE-34: Shortcuts modal footer cleanliness & ResizeObserver
});
```
