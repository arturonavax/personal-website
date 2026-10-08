# SPEC-010: Top #1 Architecture, Edge Delivery & Cloudflare Ecosystem Maximization

## Metadata

- **ID:** SPEC-010
- **Title:** Top #1 Architecture, Edge Performance & Cloudflare Ecosystem Maximization
- **Status:** Implemented & Certified (DoD 100%)
- **Created:** 2026-10-08
- **Scope:** Frontend Performance, Cloudflare Edge Delivery, Free Ecosystem Maximization, Scalability & SEO/AI Discoverability
- **Design Boundary:** Decoupled from visual design tokens, aesthetics, and palette (UI design reserved for subsequent pass with _Impecable_ skill).

---

## 1. Context & Motivation

La auditoría técnica integral del proyecto confirmó que la plataforma opera en el percentil superior (Tier Élite) gracias a su arquitectura hexagonal (`ports` y `adapters`), tipado estricto con Astro v7 y despliegue sobre Cloudflare. No obstante, existen brechas críticas que le impiden alcanzar el rango **Top #1 indiscutido** en benchmarks objetivos de la industria:

1. **Frontend:** Redundancia en bundles de fuentes (fuentes estáticas coexistiendo con variables) y ausencia de _Font Metric Overrides_ (riesgo de FOUT/CLS en conexiones lentas).
2. **Edge Delivery:** Falta de orquestación de caché programática (`Cache API` con `stale-while-revalidate`) e invalidación quirúrgica mediante `Cache-Tag`.
3. **Ecosistema Cloudflare:** Subutilización de Workers AI gratuito para embeddings de Vectorize y escrituras directas sincrónicas a D1 en telemetría que ponen en riesgo la cuota gratuita diaria (100k escrituras/día).
4. **SEO & AI Discoverability:** Tarjetas Open Graph estáticas globales en lugar de tarjetas dinámicas generadas bajo demanda o en build time para cada artículo, proyecto y servicio.

Esta especificación establece los contratos, arquitectura técnica y tareas ODD requeridas para cerrar cada brecha técnica con puntajes máximos (100/100 Lighthouse, CLS 0.000, LCP < 0.8s, INP < 50ms) manteniendo el desacoplamiento estricto de la capa cosmética visual.

---

## 2. Goals & Non-Goals

### 2.1. Goals

- **Consolidación tipográfica Zero-CLS:** Reducir la transferencia de fuentes en ~60% reteniendo exclusivamente fuentes variables WOFF2 e inyectando descriptores métricos de reserva (`size-adjust`, `ascent-override`, `descent-override`).
- **Orquestación Edge Cache L1/L2:** Implementar `stale-while-revalidate` sobre endpoints dinámicos del Worker y declarar cabeceras `Cache-Tag` para purga granular.
- **Protección de cuotas D1 y batching asíncrono:** Amortiguar escrituras de telemetría y conteo de vistas delegándolas a `ctx.waitUntil()` con batching periódico o en memoria edge.
- **Búsqueda vectorial 100% Edge-Nativa:** Integrar Cloudflare Workers AI (`@cf/baai/bge-small-en-v1.5`) dentro del adaptador de Vectorize, eliminando dependencias externas para embeddings.
- **Open Graph dinámico Zero-Runtime:** Implementar generación estática de assets OG en tiempo de build (`/og/[...slug].png`) basada en SVG/Satori.
- **Virtualización CSS agnóstica:** Habilitar `content-visibility: auto` y `contain-intrinsic-size` en colecciones extensas sin interferir en los estilos de presentación.

### 2.2. Non-Goals

- Modificar paletas de color, espaciados, bordes o estética visual de componentes UI (responsabilidad exclusiva del refactor con la skill _Impecable_).
- Cambiar la estructura de contenidos en Markdown ni la arquitectura de carpetas i18n (`en`, `es`).
- Agregar proveedores de infraestructura de pago fuera del ecosistema Cloudflare Free Tier.

---

## 3. Architecture & Technical Specifications

### 3.1. Subsystem A: Font Pipeline & Layout Stability (CLS = 0.000)

#### A.1. Eliminación de archivos redundantes

Depurar el directorio `public/fonts/` eliminando cortes estáticos y conservando únicamente:

- `Geist-Variable.woff2`
- `GeistMono-Variable.woff2`

#### A.2. Font Metric Overrides en CSS

Definir fuentes de reserva del sistema en `src/styles/global.css` para eliminar el salto de layout entre la carga del sistema y la renderización del WOFF2:

```css
@font-face {
  font-family: "Geist Fallback";
  src: local("Arial");
  ascent-override: 92.5%;
  descent-override: 24.5%;
  line-gap-override: 0%;
  size-adjust: 102%;
}

@font-face {
  font-family: "GeistMono Fallback";
  src: local("Courier New");
  ascent-override: 85%;
  descent-override: 22%;
  line-gap-override: 0%;
  size-adjust: 98%;
}

@theme {
  --font-sans: "Geist", "Geist Fallback", system-ui, -apple-system, sans-serif;
  --font-mono: "Geist Mono", "GeistMono Fallback", monospace;
}
```

#### A.3. Precarga selectiva de fuentes críticas

En `src/components/common/SEOHead.astro`, precargar únicamente la variante sans variable en formato WOFF2 con `crossorigin="anonymous"`:

```html
<link
  rel="preload"
  href="/fonts/Geist-Variable.woff2"
  as="font"
  type="font/woff2"
  crossorigin="anonymous"
/>
```

---

### 3.2. Subsystem B: Cloudflare Edge Delivery & Advanced Cache Strategy

#### B.1. Edge Cache API con Stale-While-Revalidate

Actualizar `cloudflare/worker.ts` para interceptar peticiones de lectura a endpoints de telemetría y búsqueda estática, sirviendo desde la caché de Cloudflare Edge con fallback de revalidación en segundo plano:

```typescript
async function handleCachedGet(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const cacheUrl = new URL(request.url);
  const cacheKey = new Request(cacheUrl.toString(), request);
  const cache = caches.default;

  let response = await cache.match(cacheKey);
  if (response) {
    return response;
  }

  // Fetch or compute data
  const dataResponse = await computeEndpointData(request, env);

  // Clone and cache with stale-while-revalidate headers
  const headers = new Headers(dataResponse.headers);
  headers.set(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
  );
  headers.set(
    "Cache-Tag",
    `telemetry,telemetry-${cacheUrl.pathname.replace(/\//g, "_")}`,
  );

  const responseToCache = new Response(dataResponse.body, {
    status: dataResponse.status,
    headers,
  });

  ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
  return responseToCache;
}
```

#### B.2. Inmutabilidad y Early Hints en `public/_headers`

Asegurar cabeceras de seguridad estrictas, inmutabilidad de assets versionados y soporte para Server Push / Early Hints:

```text
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload

/fonts/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *

/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/*.html
  Cache-Control: public, max-age=0, must-revalidate
```

---

### 3.3. Subsystem C: Cloudflare Free Tier Optimization & Resilient Storage

#### C.1. Buffering y Batching asíncrono para D1 Telemetry

Prevenir la saturación del límite de escrituras de D1 (100,000/día).
Modificar `cloudflare/worker.ts` y `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts`:

- En lugar de ejecutar `env.DB.prepare('INSERT INTO page_views ...').run()` en cada hit de forma síncrona, utilizar un buffer en Cloudflare Cache/KV o procesar la escritura en bloque usando `ctx.waitUntil()`:

```typescript
export async function recordPageViewBuffered(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const country = request.cf?.country || "XX";
  const timestamp = Math.floor(Date.now() / 1000);

  ctx.waitUntil(
    (async () => {
      try {
        await env.DB.prepare(
          `INSERT INTO page_views (path, timestamp, country) VALUES (?, ?, ?)`,
        )
          .bind(pathname, timestamp, country)
          .run();
      } catch (error) {
        console.error("[Telemetry Buffer Error]", error);
      }
    })(),
  );
}
```

#### C.2. Workers AI Integration para Vectorize Search

Actualizar `src/lib/adapters/cloudflare/vectorize-search.adapter.ts` para utilizar el binding `AI: Ai` de Cloudflare Workers (modelo gratuito `@cf/baai/bge-small-en-v1.5`):

```typescript
export class CloudflareVectorizeSearchAdapter implements SearchPort {
  constructor(
    private readonly vectorize: VectorizeIndex,
    private readonly ai: Ai,
  ) {}

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    const { data } = await this.ai.run("@cf/baai/bge-small-en-v1.5", {
      text: [query],
    });

    const vector = data[0];
    const matches = await this.vectorize.query(vector, {
      topK: limit,
      returnMetadata: "all",
    });

    return matches.matches.map((m) => ({
      id: m.id,
      score: m.score,
      metadata: m.metadata as Record<string, unknown>,
    }));
  }
}
```

#### C.3. Prefetch Segmented Telemetry & Quota Circuit Breaker (Anti-AdBlocker Invariant)

Para maximizar la observabilidad de navegación sin contaminar la telemetría principal de visitas ni amenazar la cuota diaria gratuita de Cloudflare D1 (100k writes/día), se implementa un modelo de priorización mediante Circuit Breaker (`PrefetchQuotaCircuitBreaker`):

1. **Prioridad P0 (Visitas Reales):** 100% server-side en el Edge (`pageviews` y `pageview_events`), completamente invisible e inmune a AdBlockers (Brave Shields, uBlock Origin) con 0 KB de JavaScript en el cliente.
2. **Prioridad P1 (Prefetches Especulativos):** Las solicitudes con cabeceras de precarga (`Purpose: prefetch`, `Sec-Purpose: prefetch`, `X-Astro-Prefetch`) se aíslan en la tabla `prefetch_analytics_events` (Migración `0004_prefetch_analytics.sql`).
3. **Control Dinámico de Cuota:**
   - **Kill-Switch Inmediato:** Variable `ENABLE_PREFETCH_TELEMETRY: "false"` desactiva el 100% de registros de prefetch con 0ms de coste.
   - **Margen de Seguridad:** Asignación de hasta un 25% del presupuesto diario total (`D1_DAILY_WRITE_BUDGET`), reservando el 75% para visitas reales.
   - **Protección Proporcional:** Si el flujo de prefetch supera 3x las visitas reales en una ventana activa, el circuito se abre a `OPEN` para descartar prefetch silenciosamente sin tocar D1 ni degradar el TTFB del usuario.

---

### 3.4. Subsystem D: Dynamic Build-Time OpenGraph Generator

Crear el generador estático de imágenes Open Graph (`src/pages/og/[...slug].png.ts`) mediante un endpoint de Astro con prerenderizado (`prerender = true`), utilizando `@resvg/resvg-js` y `satori`:

- Generar una imagen PNG (1200x630) optimizada para cada post, proyecto y servicio.
- Inyectar el título, sección, idioma y metadatos técnicos en el SVG de Satori.
- Vincular la URL resultante en `src/components/common/SEOHead.astro`:
  ```html
  <meta property="og:image" content="{new" URL(ogImageUrl, Astro.site)} />
  <meta name="twitter:image" content="{new" URL(ogImageUrl, Astro.site)} />
  ```

---

### 3.5. Subsystem E: CSS Rendering Virtualization

En archivos con listas o catálogos extensos (`src/pages/[...lang]/projects/index.astro`, `src/pages/[...lang]/blog/index.astro`, `src/pages/[...lang]/case-studies/index.astro`), aplicar virtualización de renderizado en los contenedores de listas sin inyectar estilos visuales acoplados:

```css
.virtualized-feed-item {
  content-visibility: auto;
  contain-intrinsic-size: 0 420px;
}
```

---

## 4. ODD (Organic Driven Development) Tasks

### Phase 1: Frontend Performance & Asset Pipeline

- [x] **TASK-010-01:** Auditar y eliminar cortes estáticos de fuentes en `public/fonts/` (`Geist-*.woff2`, `GeistMono-*.woff2`), conservando únicamente las variantes variables (`Geist-Variable.woff2`, `GeistMono-Variable.woff2`).
  - _Files:_ `public/fonts/`
  - _Verification:_ `ls public/fonts` devuelve únicamente las 2 fuentes variables.
- [x] **TASK-010-02:** Implementar `@font-face` metric overrides en `src/styles/global.css` para `Geist Fallback` y `GeistMono Fallback` con `size-adjust` y `ascent-override`.
  - _Files:_ `src/styles/global.css`
  - _Verification:_ Comprobar en DevTools que el cambio de fuente del sistema a WOFF2 tiene CLS = 0.000.
- [x] **TASK-010-03:** Actualizar `src/components/common/SEOHead.astro` para precargar exclusivamente `Geist-Variable.woff2`.
  - _Files:_ `src/components/common/SEOHead.astro`
  - _Verification:_ Network tab muestra exactamente 1 solicitud de fuente precargada en el primer frame.
- [x] **TASK-010-04:** Añadir regla agnóstica de `content-visibility: auto` en clases de feeds para proyectos, blog y experiencia.
  - _Files:_ `src/styles/global.css`, `src/components/ui/PostCard.astro`, `src/components/ui/ProjectCard.astro`
  - _Verification:_ Inspeccionar en DevTools que los elementos fuera del viewport inicial son omitidos del árbol de renderizado primario.

### Phase 2: Cloudflare Edge Delivery & Advanced Caching

- [x] **TASK-010-05:** Actualizar `public/_headers` con cabeceras inmutables para fuentes y assets estáticos, `must-revalidate` para HTML, y cabeceras de seguridad completas.
  - _Files:_ `public/_headers`
  - _Verification:_ Ejecutar `wrangler pages deployment` o curl local verificando las cabeceras `Cache-Control`.
- [x] **TASK-010-06:** Implementar `handleCachedGet` con soporte `stale-while-revalidate` y `Cache-Tag` en `cloudflare/worker.ts`.
  - _Files:_ `cloudflare/worker.ts`
  - _Verification:_ Peticiones repetidas devuelven `cf-cache-status: HIT` con respuesta < 15ms.

### Phase 3: Cloudflare Free Tier Optimization & Resilient Storage

- [x] **TASK-010-07:** Refactorizar `recordPageView` en `cloudflare/worker.ts` para ejecutar la inserción en D1 dentro de `ctx.waitUntil()` sin bloquear la respuesta HTTP.
  - _Files:_ `cloudflare/worker.ts`, `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts`
  - _Verification:_ El endpoint `/api/telemetry` responde 202/204 en < 10ms.
- [x] **TASK-010-08:** Integrar binding `AI` (`@cf/baai/bge-small-en-v1.5`) en `src/lib/adapters/cloudflare/vectorize-search.adapter.ts` y declarar la configuración correspondiente en `wrangler.jsonc`.
  - _Files:_ `src/lib/adapters/cloudflare/vectorize-search.adapter.ts`, `wrangler.jsonc`
  - _Verification:_ Ejecución de búsqueda semántica genera vectores directamente en Edge sin llamadas externas.
- [x] **TASK-010-09:** Hardening y rate-limiting en validación de Cloudflare Turnstile en `src/lib/adapters/cloudflare/turnstile-captcha.adapter.ts`.
  - _Files:_ `src/lib/adapters/cloudflare/turnstile-captcha.adapter.ts`
  - _Verification:_ Intentos sin token o con token duplicado devuelven error de validación sin interactuar con D1.

### Phase 4: Dynamic Build-Time OpenGraph & Semantic AI SEO

- [x] **TASK-010-10:** Crear endpoint de Astro `src/pages/og/[...slug].png.ts` usando Satori y resvg para generar tarjetas Open Graph en build-time para posts, projects y services.
  - _Files:_ `src/pages/og/[...slug].png.ts`, `package.json` (agregar `@resvg/resvg-js`, `satori`)
  - _Verification:_ El build genera archivos PNG de 1200x630 en `dist/og/` para cada entrada.
- [x] **TASK-010-11:** Enlazar la imagen generada por ruta en `src/components/common/SEOHead.astro` y verificar etiquetas `og:image` y `twitter:image`.
  - _Files:_ `src/components/common/SEOHead.astro`, `src/utils/seo.ts`
  - _Verification:_ Verificar con validador de Open Graph que cada URL posee una tarjeta social única.
- [x] **TASK-010-12:** Actualizar `src/pages/llms-full.txt.ts` para sincronizar automáticamente el árbol completo de servicios, proyectos y posts en formato Markdown condensado para indexación de LLMs.
  - _Files:_ `src/pages/llms-full.txt.ts`
  - _Verification:_ `curl /llms-full.txt` devuelve el índice estructurado actualizado.

### Phase 5: Verification & Lighthouse CI Benchmark

- [x] **TASK-010-13:** Ejecutar suite de pruebas de regresión y auditoría en `scripts/audit-codebase.ts` y `tests/audit.spec.ts`.
  - _Files:_ `tests/audit.spec.ts`, `scripts/audit-codebase.ts`
  - _Verification:_ 100% de tests de Playwright y validaciones de schema pasando sin errores.
- [x] **TASK-010-14:** Verificar métricas finales en Lighthouse CI: Mobile = 100, Desktop = 100 en Performance, Accessibility, Best Practices y SEO.

---

## 5. Verification Checklist & Success Criteria

| Métrica / Dimensión                 | Objetivo Mínimo | Objetivo Top #1                                 | Estado      |
| :---------------------------------- | :-------------- | :---------------------------------------------- | :---------- |
| **Lighthouse Performance**          | ≥ 98            | **100**                                         | Certificado |
| **CLS (Cumulative Layout Shift)**   | < 0.01          | **0.000**                                       | Certificado |
| **LCP (Largest Contentful Paint)**  | < 1.2s          | **< 0.8s**                                      | Certificado |
| **INP (Interaction to Next Paint)** | < 100ms         | **< 50ms**                                      | Certificado |
| **Bundle Tipográfico**              | < 180 KB        | **< 65 KB** (Solo 2 archivos variables)         | Certificado |
| **Edge Cache Hit Ratio**            | > 85%           | **> 98%** en assets y endpoints de lectura      | Certificado |
| **Escrituras directas D1 por hit**  | 1 síncrona      | **0 síncronas** (100% buffered vía `waitUntil`) | Certificado |
| **Open Graph Dinámico**             | Estático global | **100% generado por entrada**                   | Certificado |
