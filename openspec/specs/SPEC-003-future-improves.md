# SPEC-003: ARQUITECTURA HEXAGONAL DESACOPLADA, EDGE COMPUTING E INTERNACIONALIZACIÓN ESCALABLE

## Arquitectura Perimetral en Cloudflare Edge, Puertos y Adaptadores Hexagonales y Framework Multi-Idioma

```yaml
id: SPEC-003-CF-EDGE-DECOUPLED-I18N
title: Decoupled Cloudflare Edge Architecture, Hexagonal Ports & Adapters and Multi-Language Scalability Framework
status: APPROVED / IMPLEMENTED
version: 2.0.0
author: Staff Frontend Performance Architect & Technical SEO Lead
target_stack:
  framework: Astro v7.3.4+ (Compilación Estática Pura / ClientRouter)
  styling: Tailwind CSS v4.3.3+ (CSS-First @theme Engine / LightningCSS)
  runtime: Cloudflare Edge (Workers, D1, R2, Vectorize, Cache API, Turnstile)
  architecture: Hexagonal / Decoupled Ports & Adapters
  locales: [en, es] (EN Primario por defecto -> ES Secundario -> Extensible N)
methodology: Tri-Axis Model — Spec-Driven Development (SDD), Requirement-Driven Development (RDD) & Organic/Operational-Driven Development (ODD)
cross_references:
  spec_001: openspec/specs/SPEC-001-big-refactor.md
  spec_002: openspec/specs/SPEC-002-general-tasks.md
  spec_003: openspec/specs/SPEC-003-future-improves.md
  spec_004: openspec/specs/SPEC-004-audit.md
```

---

## 1. Resumen Ejecutivo, Diagnóstico y Alineación Metodológica

### 1.1. Contexto y Diagnóstico del Sistema

Esta especificación arquitectónica establece la infraestructura perimetral avanzada, el desacoplamiento de infraestructura mediante el patrón Hexagonal (Ports & Adapters) y la estrategia de escalabilidad multi-idioma para el portal técnico `arturonavax.dev`.

El diagnóstico del sistema previo reveló tres limitaciones fundamentales:
1. **Acoplamiento Directo al Proveedor de Nube (Vendor Lock-In):** La integración de servicios en el Edge (almacenamiento, base de datos de telemetría, indexación) corría el riesgo de acoplar componentes de Astro a las APIs propietarias de Cloudflare Workers/Pages, impidiendo una migración ágil hacia infraestructuras basadas en Node.js, Bun, Docker, AWS S3 o VPS locales.
2. **Consumo Ineficiente de Cuotas Gratuitas de Cloudflare:**
   - En **Cloudflare D1**, las consultas analíticas agregadas en tiempo real (`GROUP BY` masivos) amenazaban con superar el límite gratuito de 5 millones de filas leídas al día.
   - En **Cloudflare R2**, las solicitudes continuas de activos pesados y documentos PDF consumían operaciones de lectura Clase B sin aprovechamiento de la memoria caché de los puntos de presencia (PoPs).
3. **Escalabilidad Multi-Idioma Limitada y Dispersión de Metadatos:** El esquema de internacionalización requería un soporte formal extensible de primer nivel donde **English (`en`)** es el idioma primario absoluto y **Spanish (`es`)** es el secundario, estructurado para admitir $N$ idiomas futuros sin duplicar código ni alterar los esquemas de validación Zod, asegurando además que los esquemas JSON-LD conservaran un identificador de entidad `@id` invariable.

### 1.2. Marco Metodológico Tri-Axis: SDD, RDD y ODD

```
                            TRI-AXIS METHODOLOGY MODEL
                                    [ SDD ]
                          Contratos Hexagonales de Puerto
                                       ▲
                                      / \
                                     /   \
                                    /     \
                                   ▼       ▼
                              [ RDD ] <──> [ ODD ]
                         Requerimientos    Rendimiento Perimetral
                           Cuantitativos     y Resistencia Edge
```

- **Spec-Driven Development (SDD):** Declaración formal de interfaces de puertos en `src/lib/ports/` (`StoragePort`, `SearchEnginePort`, `TelemetryPort`, `CaptchaVerifierPort`), registro tipado de internacionalización en `src/i18n/locales.ts` y esquemas base Zod en `src/content.config.ts`.
- **Requirement-Driven Development (RDD):** Definición binaria de requerimientos técnicos (`REQ-EDGE-01` a `REQ-EDGE-08`) evaluados mediante compuertas cuantitativas estrictas (costos Clase B, filas escaneadas en D1, TTFB en caché).
- **Organic/Operational-Driven Development (ODD):** Operacionalización de adaptadores en Cloudflare Edge, rollups automáticos de telemetría mediante Cron Triggers, absorción de lectura con la Workers Cache API, enrutamiento seguro de correo corporativo y protocolo de salida (Vendor Exit Strategy) ejecutable en menos de 30 minutos.

### 1.3. Matriz de Trazabilidad y Referencias Cruzadas entre Especificaciones

- **Conexión con [SPEC-001: Arquitectura Enterprise Edge y Rutas Dinámicas i18n](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-001-big-refactor.md):** SPEC-003 implementa las abstracciones de repositorio formalizadas por SPEC-001 y amplía el motor dinámico de rutas `[...lang]` integrando el registro centralizado de locales y la cadena de fallback.
- **Conexión con [SPEC-002: Refactorización General y Resume Studio](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-002-general-tasks.md):** SPEC-003 provee los adaptadores de almacenamiento y telemetría que blindan las rutas de `/resume/` y `/resume/maker/` contra consumo excesivo de cuotas y garantizan la persistencia de contactos y eventos.
- **Conexión con [SPEC-004: Auditoría Arquitectónica Global y Verificación Extrema](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-004-audit.md):** SPEC-004 audita las compuertas perimetrales de SPEC-003 (inmutabilidad de encabezados HTTP, aislamiento de esquemas JSON-LD monobilingües con `@id` invariable y tiempo de respuesta TTFB < 25ms).

---

## 2. Matriz de Requerimientos y Compuertas Cuantitativas (RDD)

### 2.1. Requerimientos Funcionales y Técnicos (REQ-EDGE-*)

| ID | Requerimiento Técnico | Componente / Capa Afectada | Criterio de Aceptación |
| :--- | :--- | :--- | :--- |
| **REQ-EDGE-01** | **Hexagonal Decoupling & Port Purity** | `src/lib/ports/`, `src/lib/adapters/` | 100% de la lógica de dominio y presentación interactúa exclusivamente con interfaces abstractas de TypeScript. Cero importaciones directas de Cloudflare en Astro. |
| **REQ-EDGE-02** | **R2 Storage & Workers Cache API Absorption** | `CloudflareR2StorageAdapter` | Cacheado perimetral (`caches.default`) de binarios con `s-maxage=604800`. Cero lecturas Clase B en R2 tras el primer hit por PoP. |
| **REQ-EDGE-03** | **Semantic Search & Zero-Lockin Fallback** | `VectorizeAiSearchAdapter`, `StaticMemorySearchAdapter` | Búsqueda semántica acelerada por `@cf/baai/bge-small-en-v1.5` con fallback transparente a motor en memoria estática si no hay Edge disponible. |
| **REQ-EDGE-04** | **D1 Telemetry & Automated Rollups** | `cloudflare/d1/`, `cloudflare/cron-scheduler.ts` | Agregación diaria cronometrada a las 02:00 UTC. Cero `GROUP BY` masivos en tiempo real. Poda automática de eventos crudos a los 7 días. |
| **REQ-EDGE-05** | **Serverless Corporate Email Ingestion** | `cloudflare/email-worker.ts` | Captura perimetral de correos entrantes, persistencia en D1 y notificación reactiva asíncrona a Discord vía Webhooks sin impactar el hilo de respuesta. |
| **REQ-EDGE-06** | **Edge Perimeter Security & Zero Trust** | `wrangler.jsonc`, WAF L7, `_headers` | Bloqueo de scrapers de IA agresivos en `/api/*`, normalización de query params en el PoP y túnel de desarrollo seguro sin puertos públicos abiertos. |
| **REQ-EDGE-07** | **Extensible Multi-Language Engine** | `src/i18n/locales.ts`, `content.config.ts` | Soporte tipado de idiomas con inglés primario (`en`), español secundario (`es`) y extensibilidad a $N$ idiomas mediante registro central único. |
| **REQ-EDGE-08** | **Isolated JSON-LD Schema Integrity** | `src/lib/seo/schema-builder.ts` | Payloads JSON-LD 100% monobilingües sincronizados con la URL (`inLanguage`), conservando el `@id: "https://arturonavax.dev/#person"` invariable. |

### 2.2. Criterios de Aceptación Cuantitativos y Umbrales de Rendimiento

| Métrica / Parámetro | Condición de Aprobación (PASS) | Condición de Fallo (FAIL) | Método de Medición |
| :--- | :--- | :--- | :--- |
| **Desacoplamiento de Proveedor** | 0 dependencias propietarias en `src/pages/` ni `src/components/` | Importación directa de `@cloudflare/workers-types` en UI | Auditoría estática AST en CI |
| **TTFB en Activos Cacheados** | $\text{TTFB} < 25\text{ ms}$ en Edge PoP Cache Hit | $\text{TTFB} > 80\text{ ms}$ o invocación Clase B a R2 recurrente | Métricas de Cloudflare Analytics |
| **Consumo Diario D1** | $< 100,000$ filas leídas/día para analíticas | Consultas agregadas no indexadas superando 5M filas | Monitorización de cuota en Cloudflare D1 |
| **Tiempo de Migración (Exit)** | Migración a Docker/Node completada en $< 30\text{ min}$ | Modificación requerida en plantillas o rutas Astro | Simulación de despliegue con adaptadores Fallback |
| **Integridad de Esquemas SEO** | 100% de páginas válidas en Google Rich Results Test | Inconsistencias de idioma o conflictos en `@id` | Suite de validación Playwright en CI |

---

## 3. Especificación del Sistema, Tipos e Invariantes Formales (SDD)

```
                       HEXAGONAL EDGE ARCHITECTURE
 ┌────────────────────────────────────────────────────────────────────────┐
 │ ASTRO CORE APPLICATION (Domain & Presentation - 100% Vendor Agnostic)   │
 │                                                                        │
 │  ┌─────────────────────────┐         ┌──────────────────────────────┐  │
 │  │   i18n Locale Engine    │         │  Content Collections Layer   │  │
 │  │  (EN -> ES -> [Locale]) │         │   (Schema Validation / Zod)  │  │
 │  └───────────┬─────────────┘         └──────────────┬───────────────┘  │
 │              │                                      │                  │
 │              ▼                                      ▼                  │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │               CORE DOMAIN PORTS & ABSTRACTIONS                   │  │
 │  │  • StoragePort          • SearchEnginePort    • TelemetryPort    │  │
 │  │  • CaptchaVerifierPort  • NotificationPort    • CacheStoragePort │  │
 │  └─────────────────────────────────┬────────────────────────────────┘  │
 └────────────────────────────────────┼───────────────────────────────────┘
                                      │
           ┌──────────────────────────┴──────────────────────────┐
           ▼                                                     ▼
 ┌───────────────────────────────┐     ┌─────────────────────────────────┐
 │ CLOUDFLARE EDGE ADAPTERS      │     │ SELF-HOSTED / FALLBACK ADAPTERS │
 │ • CloudflareR2StorageAdapter  │     │ • S3CompatibleStorageAdapter    │
 │ • VectorizeAiSearchAdapter    │     │ • LocalMemorySearchAdapter      │
 │ • D1TelemetryAdapter          │     │ • SQLiteTelemetryAdapter        │
 │ • TurnstileCaptchaAdapter     │     │ • HoneypotCaptchaAdapter        │
 │ • CloudflareCacheApiAdapter   │     │ • MemoryCacheStorageAdapter     │
 └───────────────────────────────┘     └─────────────────────────────────┘
```

---

### 3.1. Puertos de Dominio Puros (`src/lib/ports/`)

#### 3.1.1. Puerto de Almacenamiento (`src/lib/ports/storage.port.ts`)

```typescript
export interface StorageItemMetadata {
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly etag?: string;
  readonly lastModified?: Date;
  readonly cacheControl?: string;
}

export interface StoragePort {
  get(key: string): Promise<{
    readonly data: ReadableStream | Uint8Array;
    readonly metadata: StorageItemMetadata;
  } | null>;
  put(
    key: string,
    data: ReadableStream | Uint8Array | string,
    metadata?: Partial<StorageItemMetadata>,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): string;
}
```

#### 3.1.2. Puerto de Búsqueda Semántica (`src/lib/ports/search.port.ts`)

```typescript
export interface SearchQuery {
  readonly query: string;
  readonly locale: string;
  readonly limit?: number;
  readonly threshold?: number;
}

export interface SearchResultItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly locale: string;
  readonly score: number;
}

export interface SearchEnginePort {
  search(params: SearchQuery): Promise<SearchResultItem[]>;
  indexDocument(item: SearchResultItem, content: string): Promise<void>;
}
```

#### 3.1.3. Puerto de Telemetría y Analíticas (`src/lib/ports/telemetry.port.ts`)

```typescript
export interface PageviewEvent {
  readonly path: string;
  readonly locale: string;
  readonly country?: string;
  readonly referrer?: string;
  readonly userAgent?: string;
  readonly timestamp: number;
}

export interface DailySummaryMetric {
  readonly date: string;
  readonly path: string;
  readonly locale: string;
  readonly country: string;
  readonly views: number;
}

export interface TelemetryPort {
  recordPageview(event: PageviewEvent): Promise<void>;
  getAggregatedMetrics(
    startDate: string,
    endDate: string,
  ): Promise<DailySummaryMetric[]>;
}
```

#### 3.1.4. Puerto de Verificación de Captcha y Bots (`src/lib/ports/captcha.port.ts`)

```typescript
export interface CaptchaValidationRequest {
  readonly token: string;
  readonly remoteIp?: string;
}

export interface CaptchaValidationResult {
  readonly success: boolean;
  readonly score?: number;
  readonly timestamp?: string;
  readonly hostname?: string;
  readonly errorCodes?: string[];
}

export interface CaptchaVerifierPort {
  verify(request: CaptchaValidationRequest): Promise<CaptchaValidationResult>;
}
```

---

### 3.2. Motor de Escalabilidad Multi-Idioma (`src/i18n/`)

Se abandona el soporte bilingüe cableado (`en` / `es`) en favor de un registro tipado extensible y escalable, donde **English (`en`)** es el idioma primario absoluto y **Spanish (`es`)** es el secundario, permitiendo incorporar nuevos idiomas (`fr`, `de`, `pt`) registrando la tupla en la configuración central.

#### 3.2.1. Registro Central y Tipos (`src/i18n/locales.ts`)

```typescript
export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleConfig {
  readonly code: Locale;
  readonly isoCode: string;
  readonly label: string;
  readonly dir: "ltr" | "rtl";
  readonly flag: string;
}

export const LOCALES_REGISTRY: Record<Locale, LocaleConfig> = {
  en: {
    code: "en",
    isoCode: "en-US",
    label: "English",
    dir: "ltr",
    flag: "🇺🇸",
  },
  es: {
    code: "es",
    isoCode: "es-CO",
    label: "Español",
    dir: "ltr",
    flag: "🇨🇴",
  },
};

export const FALLBACK_CHAIN: Record<Locale, Locale[]> = {
  en: ["en"],
  es: ["es", "en"],
};
```

#### 3.2.2. Patrón de Validación Localizada en Content Layer (`src/content.config.ts`)

```typescript
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { SUPPORTED_LOCALES } from "./i18n/locales";

export const localizedBaseSchema = z.object({
  canonicalId: z
    .string()
    .describe("Stable entity identifier shared across all language variants")
    .optional(),
  translationKey: z.string().optional(),
  locale: z.enum(SUPPORTED_LOCALES),
  draft: z.boolean().default(false),
  visible: z.boolean().default(true),
});

export const posts = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }),
  schema: ({ image }) =>
    localizedBaseSchema.extend({
      title: z.string().max(75, "SEO title under 75 chars"),
      description: z.string().max(160, "Meta description under 160 chars"),
      pubDate: z.coerce.date(),
      publishedAt: z.coerce.date().optional(),
      updatedDate: z.coerce.date().optional(),
      updatedAt: z.coerce.date().optional(),
      translationKey: z.string(),
      category: z.string().default("systems"),
      tags: z.array(z.string()).min(1),
      coverImage: image().optional(),
      coverAlt: z.string().optional(),
      canonicalUrl: z.url().optional(),
      searchKeywords: z.array(z.string()).optional(),
      author: z.string().default("Arturo Nava"),
      readingTimeMinutes: z.number().int().positive().optional(),
    }),
});

export const collections = { posts };
```

---

## 4. Verificación Operativa, Telemetría y Validación en Tiempo de Ejecución (ODD)

### 4.1. Adaptador de Almacenamiento: Cloudflare R2 + Workers Cache API

Intercala la **Workers Cache API** (`caches.default`) en el Edge para anular los costos de operaciones Clase B (lecturas) en Cloudflare R2:

```typescript
// src/lib/adapters/cloudflare/r2-storage.adapter.ts
import type {
  StoragePort,
  StorageItemMetadata,
} from "../../ports/storage.port";

export class CloudflareR2StorageAdapter implements StoragePort {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly publicDomain: string,
    private readonly executionCtx?: ExecutionContext,
  ) {}

  async get(key: string): Promise<{
    data: ReadableStream | Uint8Array;
    metadata: StorageItemMetadata;
  } | null> {
    const cache = caches.default;
    const cacheKey = new Request(
      `https://${this.publicDomain}/cdn-assets/${key}`,
    );
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse && cachedResponse.body) {
      return {
        data: cachedResponse.body,
        metadata: {
          contentType:
            cachedResponse.headers.get("content-type") ||
            "application/octet-stream",
          sizeBytes: Number(cachedResponse.headers.get("content-length") || 0),
          etag: cachedResponse.headers.get("etag") || undefined,
        },
      };
    }

    const object = await this.bucket.get(key);
    if (!object) return null;

    const response = new Response(object.body, {
      headers: {
        "Content-Type":
          object.httpMetadata?.contentType || "application/octet-stream",
        "Content-Length": String(object.size),
        ETag: object.httpEtag,
        "Cache-Control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    });

    if (this.executionCtx) {
      this.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return {
      data: response.body!,
      metadata: {
        contentType:
          object.httpMetadata?.contentType || "application/octet-stream",
        sizeBytes: object.size,
        etag: object.httpEtag,
        lastModified: object.uploaded,
      },
    };
  }

  async put(
    key: string,
    data: ReadableStream | Uint8Array | string,
    metadata?: Partial<StorageItemMetadata>,
  ): Promise<void> {
    await this.bucket.put(key, data, {
      httpMetadata: {
        contentType: metadata?.contentType || "application/octet-stream",
        cacheControl: metadata?.cacheControl,
      },
    });

    const cache = caches.default;
    const cacheKey = new Request(
      `https://${this.publicDomain}/cdn-assets/${key}`,
    );
    if (this.executionCtx) {
      this.executionCtx.waitUntil(cache.delete(cacheKey));
    }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
    const cache = caches.default;
    const cacheKey = new Request(
      `https://${this.publicDomain}/cdn-assets/${key}`,
    );
    if (this.executionCtx) {
      this.executionCtx.waitUntil(cache.delete(cacheKey));
    }
  }

  getPublicUrl(key: string): string {
    return `https://${this.publicDomain}/cdn-assets/${key}`;
  }
}
```

---

### 4.2. Adaptador de Búsqueda Semántica y Fallback de Memoria Estática

#### Adaptador Cloudflare Vectorize + Workers AI (`src/lib/adapters/cloudflare/vectorize-search.adapter.ts`)

```typescript
import type {
  SearchEnginePort,
  SearchQuery,
  SearchResultItem,
} from "../../ports/search.port";

export class VectorizeAiSearchAdapter implements SearchEnginePort {
  constructor(
    private readonly vectorize: VectorizeIndex,
    private readonly ai: Ai,
  ) {}

  async search(params: SearchQuery): Promise<SearchResultItem[]> {
    const embeddingResponse = (await this.ai.run(
      "@cf/baai/bge-small-en-v1.5",
      { text: params.query },
    )) as { data: number[][] };

    const vector = embeddingResponse.data[0];
    const results = await this.vectorize.query(vector, {
      topK: params.limit || 8,
      returnMetadata: true,
      filter: { locale: params.locale },
    });

    return results.matches
      .filter((match) =>
        params.threshold ? match.score >= params.threshold : true,
      )
      .map((match) => ({
        id: match.id,
        title: String(match.metadata?.title || ""),
        description: String(match.metadata?.description || ""),
        url: String(match.metadata?.url || ""),
        locale: String(match.metadata?.locale || "en"),
        score: match.score,
      }));
  }

  async indexDocument(item: SearchResultItem, content: string): Promise<void> {
    const textToEmbed = `${item.title}\n${item.description}\n${content.slice(0, 2000)}`;
    const embeddingResponse = (await this.ai.run(
      "@cf/baai/bge-small-en-v1.5",
      { text: textToEmbed },
    )) as { data: number[][] };

    await this.vectorize.insert([
      {
        id: item.id,
        values: embeddingResponse.data[0],
        metadata: {
          title: item.title,
          description: item.description,
          url: item.url,
          locale: item.locale,
        },
      },
    ]);
  }
}
```

#### Adaptador Fallback de Memoria Estática (`src/lib/adapters/fallback/static-memory-search.adapter.ts`)

```typescript
import type {
  SearchEnginePort,
  SearchQuery,
  SearchResultItem,
} from "../../ports/search.port";

export class StaticMemorySearchAdapter implements SearchEnginePort {
  constructor(
    private readonly documents: Array<SearchResultItem & { content: string }>,
  ) {}

  async search(params: SearchQuery): Promise<SearchResultItem[]> {
    const tokens = params.query.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = this.documents
      .filter((doc) => doc.locale === params.locale)
      .map((doc) => {
        const text = `${doc.title} ${doc.description} ${doc.content}`.toLowerCase();
        let hits = 0;
        for (const token of tokens) {
          if (text.includes(token)) hits++;
        }
        const score = tokens.length > 0 ? hits / tokens.length : 0;
        return { ...doc, score };
      })
      .filter((doc) => doc.score > (params.threshold || 0.1))
      .sort((a, b) => b.score - a.score)
      .slice(0, params.limit || 8);

    return matched.map(({ content, ...rest }) => rest);
  }

  async indexDocument(item: SearchResultItem, content: string): Promise<void> {
    this.documents.push({ ...item, content });
  }
}
```

---

### 4.3. Motor de Analíticas y Arquitectura de Rollups en Cloudflare D1

Para proteger la cuota gratuita diaria de D1 (5 millones de filas escaneadas) frente a agregaciones costosas, la arquitectura desacopla el evento crudo de los dashboards mediante **Daily Rollups**.

#### Migración D1 (`cloudflare/d1/migrations/0002_analytics_rollups.sql`)

```sql
-- Buffer de eventos crudos
CREATE TABLE IF NOT EXISTS pageview_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  locale TEXT NOT NULL,
  country TEXT NOT NULL,
  referrer TEXT,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pageview_timestamp ON pageview_events(timestamp);

-- Tabla de resumen diario agregada (Cero escaneos masivos en consultas)
CREATE TABLE IF NOT EXISTS pageviews_daily_summary (
  summary_date TEXT NOT NULL,
  path TEXT NOT NULL,
  locale TEXT NOT NULL,
  country TEXT NOT NULL,
  total_views INTEGER NOT NULL,
  PRIMARY KEY (summary_date, path, locale, country)
);

CREATE INDEX IF NOT EXISTS idx_summary_date ON pageviews_daily_summary(summary_date);
```

#### Motor de Cron Trigger (`cloudflare/cron-scheduler.ts`)

```typescript
export interface CronEnv {
  DB: D1Database;
}

export async function handleAnalyticsRollup(env: CronEnv): Promise<void> {
  // 1. Agregar eventos de las últimas 24 horas
  const rollupQuery = `
    INSERT INTO pageviews_daily_summary (summary_date, path, locale, country, total_views)
    SELECT
      strftime('%Y-%m-%d', datetime(timestamp / 1000, 'unixepoch')) as summary_date,
      path,
      locale,
      country,
      COUNT(id) as total_views
    FROM pageview_events
    WHERE timestamp >= (strftime('%s', 'now') - 86400) * 1000
    GROUP BY summary_date, path, locale, country
    ON CONFLICT(summary_date, path, locale, country)
    DO UPDATE SET total_views = total_views + excluded.total_views;
  `;

  await env.DB.exec(rollupQuery);

  // 2. Podar eventos con antigüedad > 7 días para preservar la cuota de almacenamiento
  const pruneQuery = `
    DELETE FROM pageview_events
    WHERE timestamp < (strftime('%s', 'now') - 604800) * 1000;
  `;

  await env.DB.exec(pruneQuery);
}
```

---

### 4.4. Ingestión Serverless de Correo Corporativo y Webhooks (`cloudflare/email-worker.ts`)

```typescript
export interface EmailEnv {
  DB: D1Database;
  DISCORD_WEBHOOK_URL: string;
}

export interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  setReject(reason: string): void;
  forward(rcptTo: string): Promise<void>;
}

export async function processIncomingEmail(
  message: ForwardableEmailMessage,
  env: EmailEnv,
  ctx: ExecutionContext,
): Promise<void> {
  const rawEmailText = await new Response(message.raw).text();
  const subject = message.headers.get("subject") || "(No Subject)";

  const dbPromise = env.DB.prepare(
    `INSERT INTO contact_leads (from_email, subject, body, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  )
    .bind(message.from, subject, rawEmailText)
    .run();

  const webhookPromise = fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: `New Lead: ${subject}`,
          description: `**From:** \`${message.from}\`\n**Date:** ${new Date().toISOString()}`,
          color: 0x5865f2,
        },
      ],
    }),
  });

  ctx.waitUntil(Promise.all([dbPromise, webhookPromise]));
}
```

---

### 4.5. Configuración Perimetral de Producción (`wrangler.jsonc`)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "arturonava-edge-platform",
  "main": "./cloudflare/worker.ts",
  "compatibility_date": "2026-03-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,

  // Mapeo de activos estáticos generados por el build SSG de Astro
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page",
  },

  // Cron Trigger diario para agregación de analítica a las 02:00 UTC
  "triggers": {
    "crons": ["0 2 * * *"],
  },

  // Enlace a Base de Datos D1
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "portfolio-production-db",
      "database_id": "ee4898ec-2df6-48eb-b5c4-7ffc5dd65318",
      "migrations_dir": "./cloudflare/d1/migrations",
    },
  ],

  // Enlace a Bucket de Almacenamiento R2
  "r2_buckets": [
    {
      "binding": "STORAGE_BUCKET",
      "bucket_name": "arturonava-production-assets",
    },
  ],

  // Enlace a Índice Vectorize para Consultas Semánticas
  "vectorize": [
    {
      "binding": "VECTORIZE_INDEX",
      "index_name": "knowledge-embeddings",
    },
  ],

  // Enlace a Modelos Workers AI
  "ai": {
    "binding": "AI",
  },
}
```

---

### 4.6. Seguridad Perimetral, Reglas WAF y Normalización Edge

#### 4.6.1. Regla WAF de Bloqueo de Bots Scrapers (Capa 7)

```
(cf.client.bot) or
(http.user_agent contains "Bytespider") or
(http.user_agent contains "ClaudeBot") or
(http.user_agent contains "CCBot") or
(http.user_agent contains "GPTBot") or
(http.user_agent contains "Amazonbot")
```
_Acción recomendada:_ **Block** o **Managed Challenge** en `/api/*`.

#### 4.6.2. Reglas de Inmutabilidad y Seguridad (`public/_headers`)

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload

/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/*.pdf
  Cache-Control: public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400
```

---

### 4.7. Estrategia de Salida de Proveedor (Vendor Exit Strategy)

Si se decide migrar fuera del ecosistema Cloudflare (hacia VPS propio, Vercel, AWS o Docker):

| Servicio Cloudflare | Sustituto Inmediato Desacoplado | Coste de Cambio en Código Astro |
| :--- | :--- | :--- |
| **Cloudflare D1** | SQLite embebido (`better-sqlite3`) o PostgreSQL en VPS. | **0 líneas** (implementar `SqliteTelemetryAdapter` respetando `TelemetryPort`). |
| **Cloudflare R2** | MinIO, AWS S3 o DigitalOcean Spaces. | **0 líneas** (implementar `S3CompatibleStorageAdapter` respetando `StoragePort`). |
| **Workers AI + Vectorize** | Ollama local / Transformers.js o Meilisearch en contenedor. | **0 líneas** (implementar `MeilisearchAdapter` respetando `SearchEnginePort`). |
| **Cloudflare Turnstile** | Honeypot invisible + Altcha (Proof of Work self-hosted). | **0 líneas** (implementar `HoneypotCaptchaAdapter` respetando `CaptchaVerifierPort`). |
| **Cache API / PoP** | Nginx Reverse Proxy / Caddy con caché de disco. | **0 líneas** (declarar cabeceras en configuración web estándar). |

#### Procedimiento de Ejecución de Migración (<30 minutos):
1. **Paso 1:** Instalar adaptadores de fallback en `src/lib/adapters/fallback/`.
2. **Paso 2:** Configurar variables en `.env`:
   ```bash
   APP_STORAGE_DRIVER=local-fs # en lugar de 'cloudflare-r2'
   APP_SEARCH_DRIVER=static-memory # en lugar de 'cloudflare-vectorize'
   APP_TELEMETRY_DRIVER=sqlite-local # en lugar de 'cloudflare-d1'
   ```
3. **Paso 3:** Exportar dump SQLite desde D1 (`wrangler d1 export`) e importarlo en el binario SQLite local sin alterar esquemas ni tablas.
4. **Paso 4:** Compilar Astro con `bun run build` (`output: 'static'` nativo) y desplegar en servidor Nginx, Docker o Node.js.

---

## 5. Matriz de Certificación, Criterios de Aceptación y Estado de Implementación (DoD)

```
================================================================================
          SPEC-003: CERTIFICACIÓN DE IMPLEMENTACIÓN (DEFINITION OF DONE)
================================================================================

[x] REQ-EDGE-01: Puertos e interfaces formales ubicados en src/lib/ports/.
[x] REQ-EDGE-02: CloudflareR2StorageAdapter con absorción perimetral via Cache API.
[x] REQ-EDGE-03: VectorizeAiSearchAdapter y StaticMemorySearchAdapter operativos.
[x] REQ-EDGE-04: Migración 0002_analytics_rollups.sql y cloudflare/cron-scheduler.ts creados.
[x] REQ-EDGE-05: cloudflare/email-worker.ts implementado con persistencia D1 y webhooks.
[x] REQ-EDGE-06: wrangler.jsonc, reglas WAF y directivas en public/_headers configuradas.
[x] REQ-EDGE-07: src/i18n/locales.ts y localizedBaseSchema en src/content.config.ts.
[x] REQ-EDGE-08: src/lib/seo/schema-builder.ts garantiza @id invariable y aislamiento i18n.
[x] VENDOR EXIT: Protocolo de salida de proveedor (<30 min) probado y documentado.
================================================================================
```
