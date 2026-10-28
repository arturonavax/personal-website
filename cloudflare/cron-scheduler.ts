/// <reference types="@cloudflare/workers-types" />
import { storedVisitDimensions } from "../src/lib/adapters/cloudflare/telemetry-dimensions";
import { buildAnalyticsRollupUpsert, rollupDimensions } from "../src/lib/adapters/cloudflare/d1-telemetry.adapter";
import { readBoundedBody } from "./runtime/request-body";

export interface CronEnv {
  DB: D1Database;
  STORAGE_BUCKET?: R2Bucket | undefined;
  R2_BUCKET?: R2Bucket | undefined;
  CONTENT_BUCKET?: R2Bucket | undefined;
}
function getWalBucket(env: CronEnv): R2Bucket | undefined {
  return env.R2_BUCKET ?? env.CONTENT_BUCKET ?? env.STORAGE_BUCKET;
}

// Producer writes one JSON visit per key and one web lead per key. These limits
// allow historical multi-line WAL but bound both memory and D1 batch work.
const MAX_OBJECTS = 20;
const MAX_SCAN_PER_PREFIX = 40; // bounded lookahead beyond poisoned oldest keys
const MAX_OBJECT_BYTES = 64 * 1024;
const MAX_RUN_BYTES = 256 * 1024;
const MAX_RECORDS = 128;
const MAX_STATEMENTS = 384; // two statements per visit; D1 batch remains small

async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  while (keys.length < MAX_SCAN_PER_PREFIX) {
    const listed = await bucket.list({ prefix, limit: MAX_SCAN_PER_PREFIX - keys.length, ...(cursor ? { cursor } : {}) });
    keys.push(...listed.objects.map(obj => obj.key));
    if (!listed.truncated || !listed.cursor || listed.cursor === cursor || !listed.objects.length) break;
    cursor = listed.cursor;
  }
  return keys;
}

function parseTelemetry(text: string): Record<string, unknown>[] | null | "deferred" {
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const rows: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      const row: unknown = JSON.parse(line);
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const v = row as Record<string, unknown>;
      if (typeof v.dedupe_key !== "string" || !v.dedupe_key ||
          typeof v.path !== "string" || !v.path.startsWith("/") ||
          typeof v.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v.created_at) ||
          !Number.isFinite(Date.parse(v.created_at)) ||
          (v.is_bot !== undefined && v.is_bot !== 0 && v.is_bot !== 1) ||
          (v.status_code !== undefined && (!Number.isInteger(v.status_code) || (v.status_code as number) < 100)) ||
          ["event_type", "visitor_hash", "bot_name", "country", "region", "device_type", "os_type", "browser", "browser_language", "referrer_host", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "bot_category"].some(field =>
            v[field] !== undefined && v[field] !== null && typeof v[field] !== "string")) return null;
      rows.push(v);
      if (rows.length > MAX_RECORDS) return "deferred";
    } catch { return null; }
  }
  return rows;
}
function parseLead(text: string): Record<string, unknown> | null {
  try {
    const row: unknown = JSON.parse(text);
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const lead = row as Record<string, unknown>;
    if (typeof (lead.from_email ?? lead.email) !== "string" || !(lead.from_email ?? lead.email) ||
        typeof (lead.body ?? lead.message) !== "string" || !(lead.body ?? lead.message) ||
        ["name", "phone", "subject", "locale", "ip", "country", "city", "region", "timezone", "as_organization", "user_agent", "referer"].some(field =>
          lead[field] !== undefined && lead[field] !== null && typeof lead[field] !== "string") ||
        (lead.created_at !== undefined && (typeof lead.created_at !== "string" || !Number.isFinite(Date.parse(lead.created_at)))) ||
        (lead.asn !== undefined && !Number.isFinite(Number(lead.asn))) ||
        (lead.turnstile_verified !== undefined && ![0, 1].includes(Number(lead.turnstile_verified)))) return null;
    return lead;
  } catch { return null; }
}

export async function reconcileR2WalToD1(env: CronEnv): Promise<{
  telemetryReconciled: number; leadsReconciled: number;
  telemetryObjectsProcessed: number; telemetryEventsInserted: number;
  leadObjectsProcessed: number; leadsInserted: number; deletedKeys: string[];
}> {
  const bucket = getWalBucket(env);
  const result = {
    telemetryReconciled: 0, leadsReconciled: 0,
    telemetryObjectsProcessed: 0, telemetryEventsInserted: 0,
    leadObjectsProcessed: 0, leadsInserted: 0, deletedKeys: [] as string[],
  };
  if (!bucket) return result;
  const telemetry = await listKeys(bucket, "wal/telemetry/");
  const leads = await listKeys(bucket, "wal/leads/");
  let bytes = 0, records = 0, statements = 0, considered = 0, invalid = 0, deferred = 0;
  const allStatements: D1PreparedStatement[] = [];
  const accepted: { key: string; events: number; lead: boolean; startsAt: number; rawOffsets: number[] }[] = [];
  const now = Date.now();
  const dimensionCutoff = new Date(now - 30 * 86_400_000).toISOString().slice(0, 10);
  // Telemetry has priority, with up to five lead slots reserved when both
  // prefixes have backlog. Bounded lookahead avoids 20 poisoned keys blocking
  // healthy neighbors, but cannot guarantee drainage beyond the scan window.
  const selectedTelemetry = telemetry.length > MAX_OBJECTS
    ? [...telemetry.slice(0, 10), ...telemetry.slice(-10)] : telemetry;
  const candidates = leads.length
    ? [...selectedTelemetry.slice(0, 15), ...leads.slice(0, 5), ...selectedTelemetry.slice(15), ...leads.slice(5)]
    : selectedTelemetry;
  for (const key of candidates) {
    if (considered >= MAX_OBJECTS || bytes >= MAX_RUN_BYTES || records >= MAX_RECORDS || statements >= MAX_STATEMENTS) break;
    considered++;
    const obj = await bucket.get(key);
    if (!obj) continue;
    if (obj.size > MAX_OBJECT_BYTES || obj.size > MAX_RUN_BYTES - bytes) { deferred++; continue; }
    let text: string | null;
    try {
      text = await readBoundedBody({ headers: new Headers(), body: obj.body }, Math.min(MAX_OBJECT_BYTES, MAX_RUN_BYTES - bytes));
    } catch { invalid++; continue; }
    if (text === null) { deferred++; continue; }
    const actualBytes = new TextEncoder().encode(text).byteLength;
    if (actualBytes !== obj.size) { invalid++; continue; } // truncated or dishonest stream
    bytes += actualBytes;
    const isTelemetry = key.startsWith("wal/telemetry/");
    const events = isTelemetry ? parseTelemetry(text) : null;
    const lead = isTelemetry ? null : parseLead(text);
    if (events === "deferred") { deferred++; continue; }
    if ((isTelemetry && !events) || (!isTelemetry && !lead)) { invalid++; continue; }
    const neededRecords = events?.length ?? 1;
    const neededStatements = events?.length ? events.length * 2 : 1;
    if (records + neededRecords > MAX_RECORDS || statements + neededStatements > MAX_STATEMENTS) { deferred++; continue; }
    const batch: D1PreparedStatement[] = [];
    const rawOffsets: number[] = [];
    if (events) {
      for (const row of events) {
        const path = String(row.path).slice(0, 255);
        const createdAt = String(row.created_at);
        const date = createdAt.slice(0, 10);
        const bot = row.is_bot === 1 ? 1 : 0;
        const stored = storedVisitDimensions(row);
        const dimensions = rollupDimensions(stored.deviceType, stored.osType);
        if (date < dimensionCutoff) for (const field of Object.keys(dimensions) as (keyof typeof dimensions)[]) dimensions[field] = 0;
        rawOffsets.push(allStatements.length + batch.length);
        batch.push(env.DB.prepare(`INSERT OR IGNORE INTO telemetry_events (
          dedupe_key, path, event_type, visitor_hash, is_bot, bot_name,
          country, device_type, region, os_type, browser, browser_language,
          referrer_host, utm_source, utm_medium, utm_campaign, utm_content,
          utm_term, bot_category, status_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          String(row.dedupe_key), path, String(row.event_type || "pageview"), String(row.visitor_hash || "anon"), bot,
          row.bot_name ? String(row.bot_name) : null, stored.country, stored.deviceType, stored.region,
          stored.osType, stored.browser, stored.browserLanguage, String(row.referrer_host || ""),
          String(row.utm_source || "direct").slice(0, 50), String(row.utm_medium || "none").slice(0, 50),
          String(row.utm_campaign || "").slice(0, 100), String(row.utm_content || "").slice(0, 100),
          String(row.utm_term || "").slice(0, 100), row.bot_category ? String(row.bot_category).slice(0, 64) : null,
          Number(row.status_code || 200), createdAt,
        ), buildAnalyticsRollupUpsert(env.DB, {
          date, path, views: 1, uniques: 1, botViews: bot, humanViews: 1 - bot, ...dimensions,
        }, true));
      }
    } else if (lead) {
      const email = String(lead.from_email || lead.email);
      const subject = String(lead.subject || "Direct Web Inquiry");
      const body = String(lead.body || lead.message);
      const created = String(lead.created_at || obj.uploaded?.toISOString() || new Date(now).toISOString());
      // A lead has no WAL key in D1. Insert each object independently; a
      // DB-success/R2-delete-failure retry can duplicate it (at-least-once).
      batch.push(env.DB.prepare(`INSERT INTO contact_leads (
        name, from_email, phone, subject, body, locale, ip, country, city, region,
        timezone, asn, as_organization, user_agent, referer, turnstile_verified, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        String(lead.name || ""), email, lead.phone ? String(lead.phone) : null, subject, body,
        String(lead.locale || "en"), String(lead.ip || "unknown"), String(lead.country || "XX"),
        String(lead.city || ""), String(lead.region || ""), String(lead.timezone || ""),
        Number(lead.asn || 0), String(lead.as_organization || ""), String(lead.user_agent || ""),
        String(lead.referer || ""), Number(lead.turnstile_verified ?? 1), created,
      ));
    }
    accepted.push({ key, events: events?.length ?? 0, lead: !events, startsAt: allStatements.length, rawOffsets });
    allStatements.push(...batch);
    records += neededRecords; statements += neededStatements;
  }
  if (allStatements.length) {
    // D1.batch is atomic: failures retain keys. Telemetry retries are idempotent;
    // lead retries after a successful batch but failed R2 delete may duplicate.
    const responses = await env.DB.batch(allStatements);
    if (responses.length !== allStatements.length || responses.some(r => !r.success)) throw new Error("WAL D1 batch unsuccessful");
    await bucket.delete(accepted.map(item => item.key));
    result.deletedKeys.push(...accepted.map(item => item.key));
    for (const item of accepted) {
      if (item.lead) {
        result.leadObjectsProcessed++;
        result.leadsReconciled++;
        result.leadsInserted += (responses[item.startsAt]?.meta?.rows_written ?? 1) > 0 ? 1 : 0;
      } else {
        result.telemetryObjectsProcessed++;
        result.telemetryReconciled += item.events;
        // Only raw INSERT results count; conditional rollups and projections do not.
        for (const index of item.rawOffsets) {
          result.telemetryEventsInserted += (responses[index]?.meta?.rows_written ?? 1) > 0 ? 1 : 0;
        }
      }
    }
  }
  if (invalid || deferred) console.warn("[WAL] retained objects", { invalid, deferred, considered });
  return result;
}

export async function handleAnalyticsRollup(env: CronEnv): Promise<void> {
  if (getWalBucket(env)) await reconcileR2WalToD1(env);
  const pruneQuery = `
    DELETE FROM telemetry_events WHERE (is_bot = 0 AND datetime(created_at) < datetime('now', '-7 days'))
      OR (is_bot = 1 AND datetime(created_at) < datetime('now', '-30 days'));
    DELETE FROM prefetch_analytics_events WHERE created_at < datetime('now', '-30 days');
    UPDATE analytics_rollups SET device_desktop = 0, device_mobile = 0,
      os_windows = 0, os_macos = 0, os_ios = 0, os_android = 0, os_linux = 0, os_other = 0
    WHERE date < date('now', '-30 days')
      AND (device_desktop != 0 OR device_mobile != 0 OR os_windows != 0 OR os_macos != 0
        OR os_ios != 0 OR os_android != 0 OR os_linux != 0 OR os_other != 0);
  `;
  await env.DB.exec(pruneQuery);
}
