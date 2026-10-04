# SPEC-003: ARCHITECTURAL SPECIFICATION, REFACTORING & OPERATIONAL DESIGN (SSD / RDD / ODD)

## Decoupled Cloudflare Edge Architecture & Multi-Language Scalability Framework

---

### DOCUMENT METADATA

- **Document ID:** SPEC-003-CF-EDGE-DECOUPLED-I18N
- **Author:** Staff Frontend Performance Architect & Design Engineer
- **Status:** APPROVED / READY FOR IMPLEMENTATION
- **Targets:** Astro v7.3.4+, Tailwind CSS v4.3.3+, Cloudflare Workers/Pages
- **Primary Goals:**
  1. Maximizar la capa gratuita y el rendimiento Edge de Cloudflare (Workers AI, Vectorize, D1 Rollups, R2 + Cache API, Turnstile, WAF, Email Routing).
  2. Desacoplamiento total del proveedor (Arquitectura Hexagonal / Ports & Adapters) para permitir migración agnóstica a Node.js, AWS, Bun, Docker o Vercel sin alterar lógica de dominio ni templates.
  3. Escalabilidad Multi-idioma de primer nivel (EN prioritario por defecto -> ES secundario -> N idiomas futuros) con tipado estricto, enlaces bidireccionales y aislamiento de metadatos JSON-LD.

---

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

# 1. SYSTEM SPECIFICATION DOCUMENT (SSD)

El propósito del SSD es definir las interfaces abstractas (Ports) y el modelo de datos agnóstico que blinda al sistema contra el acoplamiento a Cloudflare, garantizando que el núcleo de Astro opere de forma pura mediante inyección de dependencias.

### 1.1 Core Domain Interfaces (`src/lib/ports/`)

#### 1.1.1 Storage Port (`src/lib/ports/storage.port.ts`)

```typescript
export interface StorageItemMetadata {
  contentType: string;
  sizeBytes: number;
  etag?: string;
  lastModified?: Date;
  cacheControl?: string;
}

export interface StoragePort {
  get(key: string): Promise<{
    data: ReadableStream | Uint8Array;
    metadata: StorageItemMetadata;
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

#### 1.1.2 Semantic Search Port (`src/lib/ports/search.port.ts`)

```typescript
export interface SearchQuery {
  query: string;
  locale: string;
  limit?: number;
  threshold?: number;
}

export interface SearchResultItem {
  id: string;
  title: string;
  description: string;
  url: string;
  locale: string;
  score: number;
}

export interface SearchEnginePort {
  search(params: SearchQuery): Promise<SearchResultItem[]>;
  indexDocument(item: SearchResultItem, content: string): Promise<void>;
}
```

#### 1.1.3 Telemetry & Analytics Port (`src/lib/ports/telemetry.port.ts`)

```typescript
export interface PageviewEvent {
  path: string;
  locale: string;
  country?: string;
  referrer?: string;
  userAgent?: string;
  timestamp: number;
}

export interface DailySummaryMetric {
  date: string;
  path: string;
  locale: string;
  country: string;
  views: number;
}

export interface TelemetryPort {
  recordPageview(event: PageviewEvent): Promise<void>;
  getAggregatedMetrics(
    startDate: string,
    endDate: string,
  ): Promise<DailySummaryMetric[]>;
}
```

#### 1.1.4 Captcha & Bot Verification Port (`src/lib/ports/captcha.port.ts`)

```typescript
export interface CaptchaValidationRequest {
  token: string;
  remoteIp?: string;
}

export interface CaptchaValidationResult {
  success: boolean;
  score?: number;
  timestamp?: string;
  hostname?: string;
  errorCodes?: string[];
}

export interface CaptchaVerifierPort {
  verify(request: CaptchaValidationRequest): Promise<CaptchaValidationResult>;
}
```

---

### 1.2 Multi-Language Architecture Specification (`src/i18n/`)

Se abandona el soporte bilingüe cableado (`en` / `es`) en favor de un registro tipado extensible y escalable, donde **English (`en`)** es el idioma primario absoluto y **Spanish (`es`)** es el secundario, permitiendo añadir nuevos idiomas (`fr`, `de`, `pt`) únicamente registrando la tupla en la configuración central.

#### 1.2.1 Central Registry & Type Definitions (`src/i18n/locales.ts`)

```typescript
export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleConfig {
  code: Locale;
  isoCode: string;
  label: string;
  dir: "ltr" | "rtl";
  flag: string;
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

#### 1.2.2 Unified Schema Localization Pattern (`src/content.config.ts`)

Para evitar duplicar código Zod entre idiomas, se implementa una función de fábrica agnóstica de colecciones que requiere explícitamente el metadato `canonicalId` o `translationKey`, garantizando relaciones bidireccionales 1:1 entre distintas traducciones de una misma entidad.

```typescript
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { SUPPORTED_LOCALES } from "./i18n/locales";

const localizedBaseSchema = z.object({
  canonicalId: z
    .string()
    .describe("Stable entity identifier shared across all language variants"),
  locale: z.enum(SUPPORTED_LOCALES),
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  draft: z.boolean().default(false),
});

export const postsCollection = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }),
  schema: localizedBaseSchema.extend({
    author: z.string().default("Arturo Nava"),
    readingTimeMinutes: z.number().int().positive().optional(),
  }),
});

export const collections = {
  posts: postsCollection,
};
```

---

# 2. REFACTORING & DESIGN DOCUMENT (RDD)

El RDD detalla la implementación técnica paso a paso para adoptar las capacidades avanzadas de Cloudflare sin comprometer el desacoplamiento, integrando la refactorización de infraestructura y de código.

### 2.1 Storage Adapter: Cloudflare R2 + Workers Cache API (`src/lib/adapters/`)

Para neutralizar los costes de operaciones Clase B (lecturas) en R2, la arquitectura intercala la **Workers Cache API** (`caches.default`) en el Edge. El primer request obtiene el binario desde R2 y lo serializa en la memoria caché del PoP con cabecera `s-maxage`; las subsiguientes solicitudes se sirven a 0 lecturas de R2 y <15 ms TTFB.

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
        contentType: metadata?.contentType,
        cacheControl: metadata?.cacheControl,
      },
    });
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  getPublicUrl(key: string): string {
    return `https://${this.publicDomain}/${key}`;
  }
}
```

```typescript
// src/lib/adapters/fallback/local-filesystem-storage.adapter.ts
import type {
  StoragePort,
  StorageItemMetadata,
} from "../../ports/storage.port";
import fs from "node:fs/promises";
import path from "node:path";

export class LocalFileSystemStorageAdapter implements StoragePort {
  constructor(
    private readonly baseDirectory: string,
    private readonly baseUrl: string,
  ) {}

  async get(key: string): Promise<{
    data: ReadableStream | Uint8Array;
    metadata: StorageItemMetadata;
  } | null> {
    const fullPath = path.join(this.baseDirectory, key);
    try {
      const buffer = await fs.readFile(fullPath);
      const stat = await fs.stat(fullPath);
      return {
        data: buffer,
        metadata: {
          contentType: "application/octet-stream",
          sizeBytes: stat.size,
          lastModified: stat.mtime,
        },
      };
    } catch {
      return null;
    }
  }

  async put(
    key: string,
    data: ReadableStream | Uint8Array | string,
  ): Promise<void> {
    const fullPath = path.join(this.baseDirectory, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    if (typeof data === "string" || data instanceof Uint8Array) {
      await fs.writeFile(fullPath, data);
    } else {
      const arrayBuffer = await new Response(data).arrayBuffer();
      await fs.writeFile(fullPath, Buffer.from(arrayBuffer));
    }
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(path.join(this.baseDirectory, key)).catch(() => {});
  }

  getPublicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}
```

---

### 2.2 Semantic Search Engine: Vectorize + Workers AI con Fallback a JSON

Se implementa una arquitectura híbrida:

1. **Edge Mode:** Inferencia de embeddings en <20 ms mediante `@cf/baai/bge-small-en-v1.5` en Workers AI + consulta en Cloudflare Vectorize.
2. **Fallback Mode:** Si la base vectorial no está disponible o el hosting cambia a Node/SSG, se consulta un índice estático precompilado mediante algoritmo de distancia Levenshtein/Token Jaccard en memoria.

```typescript
// src/lib/adapters/cloudflare/vectorize-search.adapter.ts
import type {
  SearchEnginePort,
  SearchQuery,
  SearchResultItem,
} from "../../ports/search.port";

export interface CloudflareAiBinding {
  run(
    model: string,
    input: { text: string[] | string },
  ): Promise<{ data: number[][] }>;
}

export interface CloudflareVectorizeBinding {
  query(
    vector: number[],
    options?: {
      topK?: number;
      returnMetadata?: boolean;
      filter?: Record<string, string>;
    },
  ): Promise<{
    matches: Array<{
      id: string;
      score: number;
      metadata?: Record<string, unknown>;
    }>;
  }>;
  insert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<unknown>;
}

export class CloudflareVectorizeSearchAdapter implements SearchEnginePort {
  constructor(
    private readonly ai: CloudflareAiBinding,
    private readonly vectorize: CloudflareVectorizeBinding,
  ) {}

  async search(params: SearchQuery): Promise<SearchResultItem[]> {
    const embeddingResponse = await this.ai.run("@cf/baai/bge-small-en-v1.5", {
      text: params.query,
    });

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
    const embeddingResponse = await this.ai.run("@cf/baai/bge-small-en-v1.5", {
      text: textToEmbed,
    });

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

```typescript
// src/lib/adapters/fallback/static-memory-search.adapter.ts
import type { SearchEnginePort, SearchQuery, SearchResultItem } from '../../ports/search.port';

export class StaticMemorySearchAdapter implements SearchEnginePort {
  constructor(private readonly documents: Array<SearchResultItem & content: string { }>) {}

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

### 2.3 Analytics Engine & D1 Rollup Architecture

Para proteger la cuota gratuita diaria de D1 (5 millones de filas escaneadas) frente a agregaciones costosas (`GROUP BY` masivos en tiempo real), la arquitectura desacopla el evento crudo de los dashboards mediante **Daily Rollups**.

#### 2.3.1 D1 Schema Migration (`cloudflare/d1/migrations/0002_analytics_rollups.sql`)

```sql
-- Raw pageviews buffer
CREATE TABLE IF NOT EXISTS pageview_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  locale TEXT NOT NULL,
  country TEXT NOT NULL,
  referrer TEXT,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pageview_timestamp ON pageview_events(timestamp);

-- Aggregated Daily Summary Table (Zero Full Scans on queries)
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

#### 2.3.2 Cron Trigger Engine (`cloudflare/cron-scheduler.ts`)

```typescript
export interface CronEnv {
  DB: D1Database;
}

export async function handleAnalyticsRollup(env: CronEnv): Promise<void> {
  // Aggregate pageviews from the preceding 24h
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

  // Prune events older than 7 days to preserve D1 storage limit (500MB free)
  const pruneQuery = `
    DELETE FROM pageview_events
    WHERE timestamp < (strftime('%s', 'now') - 604800) * 1000;
  `;

  await env.DB.exec(pruneQuery);
}
```

---

### 2.4 Serverless Corporate Email Ingestion & Webhooks

```typescript
// cloudflare/email-worker.ts
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

  // Persist directly to D1
  const dbPromise = env.DB.prepare(
    `INSERT INTO contact_leads (from_email, subject, body, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  )
    .bind(message.from, subject, rawEmailText)
    .run();

  // Trigger instant notification webhook
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

### 2.5 Multi-Language Canonical SEO & JSON-LD Isolation

El componente de metadatos garantiza la separación estricta por URL según las especificaciones de Google Rich Results, conservando el identificador `@id` global invariable para que los Knowledge Graphs consoliden la entidad.

```typescript
// src/lib/seo/schema-builder.ts
import type { Locale } from "../../i18n/locales";

interface SchemaPersonOptions {
  locale: Locale;
  canonicalUrl: string;
  jobTitle: string;
  description: string;
}

export function buildPersonJsonLd(
  options: SchemaPersonOptions,
): Record<string, unknown> {
  return {
    "@context": "[https://schema.org](https://schema.org)",
    "@type": "Person",
    "@id": "[https://arturonavax.dev/#person](https://arturonavax.dev/#person)",
    inLanguage: options.locale,
    name: "Arturo Nava",
    jobTitle: options.jobTitle,
    description: options.description,
    url: options.canonicalUrl,
    sameAs: [
      "[https://github.com/arturonavax](https://github.com/arturonavax)",
      "[https://linkedin.com/in/arturonava](https://linkedin.com/in/arturonava)",
    ],
  };
}
```

---

# 3. OPERATIONAL DESIGN DOCUMENT (ODD)

El ODD formaliza las configuraciones de red, seguridad perimetral, variables de entorno y el protocolo de contingencia/migración hacia otras plataformas.

### 3.1 Production Edge Configuration (`wrangler.jsonc`)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "arturonava-edge-platform",
  "main": "./cloudflare/worker.ts",
  "compatibility_date": "2026-03-01",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,

  // Static Assets mapping for Astro SSG build
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page",
  },

  // Cron Triggers for Analytical Rollups
  "triggers": {
    "crons": ["0 2 * * *"], // Executed daily at 02:00 UTC
  },

  // D1 Database Binding
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "portfolio-production-db",
      "database_id": "ee4898ec-2df6-48eb-b5c4-7ffc5dd65318",
      "migrations_dir": "./cloudflare/d1/migrations",
    },
  ],

  // R2 Decoupled Heavy Storage
  "r2_buckets": [
    {
      "binding": "STORAGE_BUCKET",
      "bucket_name": "arturonava-production-assets",
    },
  ],

  // Vectorize Index for Semantic Queries
  "vectorize": [
    {
      "binding": "VECTORIZE_INDEX",
      "index_name": "knowledge-embeddings",
    },
  ],

  // Workers AI Acceleration
  "ai": {
    "binding": "AI",
  },
}
```

---

### 3.2 Perimeter Security, WAF Rules & Edge Normalization

#### 3.2.1 WAF Bot Defense Expression (Cloudflare Dashboard / Terraform)

Expresión de filtrado en capa 7 para bloquear scrapers de IA agresivos y proteger los workers:

```
(cf.client.bot) or
(http.user_agent contains "Bytespider") or
(http.user_agent contains "ClaudeBot") or
(http.user_agent contains "CCBot") or
(http.user_agent contains "GPTBot") or
(http.user_agent contains "Amazonbot")
```

_Action:_ **Block** o **Managed Challenge** en endpoints de API (`/api/*`).

#### 3.2.2 Query Parameter Normalization (Transform Rules)

Para evitar que parámetros de seguimiento de redes sociales destruyan el _Edge Cache Hit Ratio_, se añade una regla HTTP Request Modification:

- **Expression:** `http.request.uri.path eq "/api/search"`
- **Stripped Query Parameters:** `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `fbclid`, `gclid`.

#### 3.2.3 Edge Security Headers (`public/_headers`)

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

### 3.3 Zero Trust & Tunneling Bastion Architecture

```
                                CLOUDFLARE ZERO TRUST
 [DEVELOPER MACHINE]                                                 [PUBLIC EDGE]
 localhost:4321 (Astro Staging) <──┐                                      │
 localhost:8080 (D1 Local Studio)<─┼─ cloudflared tunnel ───> edge.arturonavax.dev
                                   │                              │
                                   └───────── Cloudflare Access ──┘
                                              (GitHub OAuth + 2FA / WebAuthn)
```

1. **Configuración de Túnel:**
   ```bash
   cloudflared tunnel create staging-tunnel
   cloudflared tunnel route dns staging-tunnel staging.arturonavax.dev
   ```
2. **Acceso Seguro sin Puertos Abiertos:** El daemon `cloudflared` conecta mediante WebSockets salientes con el Edge. Ninguna IP residencial queda expuesta. Cloudflare Access evalúa la identidad de GitHub antes de enrutar cualquier paquete.

---

### 3.4 Vendor Exit Strategy: Protocolo de Desacoplamiento

Si se decide migrar fuera del ecosistema Cloudflare (hacia VPS propio, Vercel, AWS o Docker):

| Servicio Cloudflare        | Sustituto Inmediato Desacoplado                             | Coste de Cambio en Código Astro                                                       |
| :------------------------- | :---------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| **Cloudflare D1**          | SQLite embebido (`better-sqlite3`) o PostgreSQL en VPS.     | **0 líneas** (implementar `SqliteTelemetryAdapter` respetando `TelemetryPort`).       |
| **Cloudflare R2**          | MinIO, AWS S3 o DigitalOcean Spaces.                        | **0 líneas** (implementar `S3CompatibleStorageAdapter` respetando `StoragePort`).     |
| **Workers AI + Vectorize** | Ollama local / Transformers.js o Meilisearch en contenedor. | **0 líneas** (implementar `MeilisearchAdapter` respetando `SearchEnginePort`).        |
| **Cloudflare Turnstile**   | Honeypot invisible + Altcha (Proof of Work self-hosted).    | **0 líneas** (implementar `HoneypotCaptchaAdapter` respetando `CaptchaVerifierPort`). |
| **Cache API / PoP**        | Nginx Reverse Proxy / Caddy con caché de disco.             | **0 líneas** (declarar cabeceras en configuración web estándar).                      |

#### Procedimiento de Ejecución de Migración (<30 minutos):

1. **Paso 1:** Instalar adaptadores de fallback en `src/lib/adapters/fallback/`.
2. **Paso 2:** Cambiar variable de entorno en `.env`:
   ```bash
   APP_STORAGE_DRIVER=local-fs # de 'cloudflare-r2'
   APP_SEARCH_DRIVER=static-memory # de 'cloudflare-vectorize'
   APP_TELEMETRY_DRIVER=sqlite-local # de 'cloudflare-d1'
   ```
3. **Paso 3:** Exportar dump de SQLite de D1 mediante `wrangler d1 export` e importarlo directamente en el binario SQLite local sin alterar schemas ni tablas.
4. **Paso 4:** Compilar Astro con `pnpm build` (`output: 'static'` nativo) y montar sobre cualquier servidor web Nginx, Docker o Node.js.
