/// <reference types="@cloudflare/workers-types" />
import {
  buildAnalyticsRollupUpsert,
  rollupDimensions,
  type CompactRollupEntry,
} from "../src/lib/adapters/cloudflare/d1-telemetry.adapter";

export interface CronEnv {
  DB: D1Database;
  STORAGE_BUCKET?: R2Bucket | undefined;
  R2_BUCKET?: R2Bucket | undefined;
  CONTENT_BUCKET?: R2Bucket | undefined;
}

function getWalBucket(env: CronEnv): R2Bucket | undefined {
  return env.R2_BUCKET ?? env.CONTENT_BUCKET ?? env.STORAGE_BUCKET;
}

async function readR2ObjectText(
  obj: R2ObjectBody | { body?: unknown; text?: () => Promise<string> },
): Promise<string> {
  if (typeof (obj as { text?: () => Promise<string> }).text === "function") {
    return (obj as { text: () => Promise<string> }).text();
  }
  const body = (obj as { body?: unknown }).body;
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (body && typeof (body as ReadableStream).getReader === "function") {
    return new Response(body as ReadableStream).text();
  }
  return "";
}

async function listR2Keys(
  bucket: R2Bucket,
  prefix: string,
  limit?: number,
): Promise<string[]> {
  if (typeof bucket.list !== "function") return [];
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const maxKeys = limit ? Math.min(limit - keys.length, 1000) : undefined;
    const opts: R2ListOptions = {
      prefix,
      ...(cursor ? { cursor } : {}),
      ...(maxKeys ? { limit: maxKeys } : {}),
    };
    const listed = await bucket.list(opts);
    for (const obj of listed.objects || []) {
      keys.push(obj.key);
      if (limit && keys.length >= limit) break;
    }
    cursor =
      listed.truncated && (!limit || keys.length < limit)
        ? listed.cursor
        : undefined;
  } while (cursor && (!limit || keys.length < limit));
  return keys;
}

export async function reconcileR2WalToD1(env: CronEnv): Promise<{
  telemetryReconciled: number;
  leadsReconciled: number;
  telemetryObjectsProcessed: number;
  telemetryEventsInserted: number;
  leadObjectsProcessed: number;
  leadsInserted: number;
  deletedKeys: string[];
}> {
  const bucket = getWalBucket(env);
  if (!bucket) {
    return {
      telemetryReconciled: 0,
      leadsReconciled: 0,
      telemetryObjectsProcessed: 0,
      telemetryEventsInserted: 0,
      leadObjectsProcessed: 0,
      leadsInserted: 0,
      deletedKeys: [],
    };
  }

  let telemetryReconciled = 0;
  let leadsReconciled = 0;
  let telemetryObjectsProcessed = 0;
  let leadObjectsProcessed = 0;
  const deletedKeys: string[] = [];

  const MAX_WAL_OBJECTS_PER_CRON = 20;

  // 1. Reconcile wal/telemetry/ NDJSON objects (capped at 20)
  const telemetryKeys = await listR2Keys(
    bucket,
    "wal/telemetry/",
    MAX_WAL_OBJECTS_PER_CRON,
  );
  const remainingSlots = Math.max(
    0,
    MAX_WAL_OBJECTS_PER_CRON - telemetryKeys.length,
  );
  const leadKeys =
    remainingSlots > 0
      ? await listR2Keys(bucket, "wal/leads/", remainingSlots)
      : [];

  const allStatements: D1PreparedStatement[] = [];
  const processedKeys: string[] = [];

  if (telemetryKeys.length > 0) {
    const rawEvents: Array<{
      rollup: CompactRollupEntry;
      dedupe_key: string;
      path: string;
      event_type: string;
      visitor_hash: string;
      is_bot: number;
      bot_name: string | null;
      country: string;
      device_type: string;
      referrer_host: string;
      status_code: number;
      created_at: string;
    }> = [];

    for (const key of telemetryKeys) {
      const obj = await bucket.get(key);
      if (!obj) continue;
      const text = await readR2ObjectText(obj);
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const path = String(parsed.path || "/").slice(0, 255);
          const createdAt = String(
            parsed.created_at || new Date().toISOString(),
          );
          const date = createdAt.slice(0, 10);
          const isBot = Number(parsed.is_bot) === 1 ? 1 : 0;
          const humanInc = isBot === 0 ? 1 : 0;
          const dedupeKey = String(
            parsed.dedupe_key ||
              `wal:${parsed.visitor_hash || "anon"}:${path}:${date}`,
          );

          const device = parsed.device_type === "mobile" ? "mobile" : "desktop";
          const dimensions = rollupDimensions(
            device,
            String(parsed.os_type || "other"),
          );
          // Old WAL can arrive after the cron retention pass. Keep its views but
          // do not restore expired dimensions or spend another D1 cleanup write.
          const dimensionCutoff = new Date(Date.now() - 30 * 86_400_000)
            .toISOString()
            .slice(0, 10);
          if (date < dimensionCutoff) {
            for (const field of Object.keys(
              dimensions,
            ) as (keyof typeof dimensions)[]) {
              dimensions[field] = 0;
            }
          }
          rawEvents.push({
            rollup: {
              date,
              path,
              views: 1,
              uniques: 1,
              botViews: isBot,
              humanViews: humanInc,
              ...dimensions,
            },
            dedupe_key: dedupeKey,
            path,
            event_type: String(parsed.event_type || "pageview"),
            visitor_hash: String(parsed.visitor_hash || "anon"),
            is_bot: isBot,
            bot_name: parsed.bot_name ? String(parsed.bot_name) : null,
            country: String(parsed.country || "XX"),
            device_type: String(parsed.device_type || "desktop"),
            referrer_host: String(parsed.referrer_host || ""),
            status_code: Number(parsed.status_code || 200),
            created_at: createdAt,
          });
          telemetryReconciled += 1;
        } catch {
          // Skip malformed NDJSON line
        }
      }
      processedKeys.push(key);
      telemetryObjectsProcessed += 1;
    }

    for (const ev of rawEvents) {
      allStatements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO telemetry_events (
            dedupe_key, path, event_type, visitor_hash, is_bot, bot_name,
            country, device_type, referrer_host, status_code, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          ev.dedupe_key,
          ev.path,
          ev.event_type,
          ev.visitor_hash,
          ev.is_bot,
          ev.bot_name,
          ev.country,
          ev.device_type,
          ev.referrer_host,
          ev.status_code,
          ev.created_at,
        ),
        // Adjacent statements in the same D1 batch preserve exactly-once
        // rollups even when an object is retried or repeats a dedupe key.
        buildAnalyticsRollupUpsert(env.DB, ev.rollup, true),
      );
    }
  }

  // 2. Reconcile wal/leads/ JSON objects
  if (leadKeys.length > 0) {
    for (const key of leadKeys) {
      const obj = await bucket.get(key);
      if (!obj) continue;
      const text = await readR2ObjectText(obj);
      try {
        const lead = JSON.parse(text) as Record<string, unknown>;
        allStatements.push(
          env.DB.prepare(
            `INSERT INTO contact_leads (
              name, from_email, phone, subject, body, locale,
              ip, country, city, region, timezone, asn, as_organization,
              user_agent, referer, turnstile_verified, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            String(lead.name || ""),
            String(lead.from_email || lead.email || ""),
            lead.phone ? String(lead.phone) : null,
            String(lead.subject || "Direct Web Inquiry"),
            String(lead.body || lead.message || ""),
            String(lead.locale || "en"),
            String(lead.ip || "unknown"),
            String(lead.country || "XX"),
            String(lead.city || ""),
            String(lead.region || ""),
            String(lead.timezone || ""),
            Number(lead.asn || 0),
            String(lead.as_organization || ""),
            String(lead.user_agent || ""),
            String(lead.referer || ""),
            Number(lead.turnstile_verified ?? 1),
            String(lead.created_at || new Date().toISOString()),
          ),
        );
        processedKeys.push(key);
        leadObjectsProcessed += 1;
        leadsReconciled += 1;
      } catch {
        // Ignore malformed lead payload
      }
    }
  }

  // 3. Execute a SINGLE batch call for all D1 statements (1 subrequest)
  if (allStatements.length > 0) {
    if (typeof env.DB.batch === "function") {
      await env.DB.batch(allStatements);
    } else {
      for (const stmt of allStatements) {
        await stmt.run();
      }
    }
  }

  // 4. Delete all processed keys in a SINGLE bulk R2 call (1 subrequest)
  if (processedKeys.length > 0) {
    if (typeof bucket.delete === "function") {
      await bucket.delete(processedKeys);
    }
    deletedKeys.push(...processedKeys);
  }

  return {
    telemetryReconciled,
    leadsReconciled,
    telemetryObjectsProcessed,
    telemetryEventsInserted: telemetryReconciled,
    leadObjectsProcessed,
    leadsInserted: leadsReconciled,
    deletedKeys,
  };
}

export async function handleAnalyticsRollup(env: CronEnv): Promise<void> {
  // Rebuild both complete UTC calendar days touched by the daily cron.
  const rollupQuery = `
    INSERT INTO pageviews_daily_summary (summary_date, path, locale, country, total_views)
    SELECT
      strftime('%Y-%m-%d', datetime(timestamp / 1000, 'unixepoch')) as summary_date,
      path,
      locale,
      country,
      COUNT(id) as total_views
    FROM pageview_events
    WHERE timestamp >= strftime('%s', 'now', '-1 day', 'start of day') * 1000
    GROUP BY summary_date, path, locale, country
    ON CONFLICT(summary_date, path, locale, country)
    DO UPDATE SET total_views = excluded.total_views;
  `;

  await env.DB.exec(rollupQuery);

  // Prune raw event detail to limit storage (Free: 500 MB per D1 database).
  const pruneQuery = `
    DELETE FROM pageview_events
    WHERE timestamp < (strftime('%s', 'now') - 604800) * 1000;

    DELETE FROM telemetry_events
    WHERE datetime(created_at) < datetime('now', '-7 days');

    DELETE FROM pageviews
    WHERE created_at < datetime('now', '-30 days');

    DELETE FROM prefetch_analytics_events
    WHERE created_at < datetime('now', '-30 days');

    DELETE FROM edge_telemetry_events
    WHERE timestamp < (strftime('%s', 'now') - 604800) * 1000;

    UPDATE analytics_rollups SET
      device_desktop = 0, device_mobile = 0,
      os_windows = 0, os_macos = 0, os_ios = 0,
      os_android = 0, os_linux = 0, os_other = 0
    WHERE date < date('now', '-30 days')
      AND (device_desktop != 0 OR device_mobile != 0 OR os_windows != 0
        OR os_macos != 0 OR os_ios != 0 OR os_android != 0
        OR os_linux != 0 OR os_other != 0);
  `;

  await env.DB.exec(pruneQuery);

  // Reconcile any R2 Write-Ahead Log (WAL) telemetry & contact lead objects when R2 bucket is bound
  if (getWalBucket(env)) {
    await reconcileR2WalToD1(env);
  }
}
