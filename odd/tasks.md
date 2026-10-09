# Tareas del Proyecto (ODD)

## Refinar /admin

Esta ruta solo deberia ser accesible por medio de la autenticacion gratuita de cloudflare para paginas estaticas. (Menos en local por supuesto).

Debe tener la misma interfaz de todas las demas paginas (mismo menu superior (theme y language switch) y footer).

Refinar dashboard en general: Analizar schema total actual integrar las metricas mas interesantes posibles, con selects, filtros, checks, secciones, incluso graficos de alto rendimiento de ser viable.

## Task: Production-Ready Cal.com Integration for Astro & Tailwind CSS

Incluir boton en el banner principal y en Contact como reemplazo a Start a conversation (el cual solo copiaba el email y era redundante)

### Context & Technical Stack

You are implementing a high-performance booking integration for a static website built with **Astro (Static Output)**, **Tailwind CSS v4**, and deployed on **Cloudflare Pages**. Target Core Web Vitals thresholds: **CLS = 0.000**, **INP < 50ms**, **LCP < 0.8s**, and **0 KB initial third-party vendor JavaScript**.

User Cal.com identifier: `arturonavax`

---

### Architectural Requirements

#### 1. Zero Initial Vendor Overhead

- Do **NOT** include any external scripts (e.g., `https://app.cal.com/embed/embed.js`) in the global layout, document `<head>`, or initial DOM payload.
- The booking solution must support two selectable modes via props:
- **Direct Mode (`variant="direct"`):** Accessible semantic `<a>` link opening `https://cal.com/{calLink}` in `_blank` with `rel="noopener noreferrer"`. Zero client-side JavaScript execution.
- **Modal Mode (`variant="modal"`):** Interactive button triggering a native HTML5 `<dialog>` element. The Cal.com vendor script must be injected dynamically **strictly on the user's first click event**.

#### 2. Native Dialog & Modal Mechanics

- Use the semantic `<dialog>` element (native `.showModal()` and `.close()` methods).
- Support native backdrop dismissal: clicking the pseudo-element backdrop or pressing the `Escape` key must cleanly close the dialog.
- Provide an explicit accessible close button with `aria-label="Close modal"` and visible focus rings.
- Prevent layout shifts when opening/closing by preserving scrollbar stability (`scrollbar-gutter: stable`).
- Clean up or isolate modal state to prevent multiple duplicate script tags from appending if clicked repeatedly.

#### 3. Astro ClientRouter / View Transitions Compatibility

- If View Transitions (`astro:transitions`) are enabled, DOM elements are swapped during page navigation.
- Component scripts must attach event listeners cleanly on both initial load and the `astro:after-swap` lifecycle event to prevent dead listeners on client-side navigation.

#### 4. Design & Styling Directives (Tailwind CSS v4)

- Style with semantic, professional design tokens suitable for high-end engineering portfolios (neutral dark tones, subtle borders, high contrast).
- Avoid generic AI styling tropes (no arbitrary neon gradients, no exaggerated drop shadows, no unsolicited decorative emojis).
- Focus indicators: Ensure full accessibility compliance using `focus-visible:ring-2` with sufficient contrast.
- Animations: Restrict interactive transitions strictly to compositor-driven properties (`opacity`, `transform`). Never animate layout dimensions (`width`, `height`, `padding`).

#### 5. Edge Security & Cloudflare Headers

- Provide or update the `public/_headers` file for Cloudflare Pages to ensure the Content Security Policy (CSP) permits Cal.com without console errors:
- `script-src` must whitelist `https://app.cal.com`
- `frame-src` and `child-src` must whitelist `https://app.cal.com` and `https://cal.com`
- `connect-src` must permit API sync with `https://cal.com` and `https://app.cal.com`

---

### Deliverables Expected

1. **Self-contained Astro Component:** `src/components/ScheduleButton.astro` implementing strictly typed props (`calLink`, `variant`, `label`, `class`).
2. **Usage Example:** Implementation snippet showing both direct link and modal usage patterns inside an Astro page.
3. **Cloudflare Security Headers:** Required rules for `public/_headers` to ensure zero CSP violations on Edge deployment.
