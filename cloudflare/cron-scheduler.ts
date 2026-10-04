/// <reference types="@cloudflare/workers-types" />

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
