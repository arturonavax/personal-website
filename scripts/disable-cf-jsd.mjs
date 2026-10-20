#!/usr/bin/env node
/**
 * Cloudflare Edge Zone Bot Management / JSD Disabler
 *
 * Disables automatic injection of /cdn-cgi/challenge-platform/scripts/jsd/main.js
 * which triggers Lighthouse Best Practices deprecation warnings (StorageType.persistent,
 * Protected Audience API) and degrades Core Web Vitals.
 */

const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

async function disableCfJsd() {
  if (!zoneId || !apiToken) {
    console.log(
      "[disable-cf-jsd] CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN not set. Skipping zone API update.",
    );
    return;
  }

  const endpoint = `https://api.cloudflare.com/client/v4/zones/${zoneId}/bot_management`;
  const payload = {
    fight_mode: false,
    enable_js: false,
  };

  try {
    console.log(
      `[disable-cf-jsd] Updating Bot Management settings for zone ${zoneId}...`,
    );
    const res = await fetch(endpoint, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      console.log(
        "[disable-cf-jsd] [SUCCESS] Successfully disabled Cloudflare Bot Management fight_mode and enable_js.",
      );
    } else {
      console.warn(
        `[disable-cf-jsd] [WARNING] Cloudflare API responded with status ${res.status}:`,
        JSON.stringify(data.errors || data),
      );
    }
  } catch (err) {
    console.error(
      "[disable-cf-jsd] [ERROR] Failed to update Cloudflare Bot Management settings:",
      err,
    );
  }
}

disableCfJsd();
