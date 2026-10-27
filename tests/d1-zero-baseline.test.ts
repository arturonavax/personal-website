import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const d1 = join(process.cwd(), "cloudflare", "d1");
const sql = (file: string) => readFileSync(join(d1, file), "utf8");

function objects(source: string) {
  const db = new Database(":memory:");
  try {
    db.exec(source);
    return (
      db
        .query(
          `SELECT type, name, sql FROM sqlite_master
           WHERE type IN ('table', 'index', 'view')
             AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations'
           ORDER BY type, name`,
        )
        .all() as { type: string; name: string; sql: string }[]
    ).map(({ type, name, sql }) => ({
      type,
      name,
      definition:
        name === "telemetry_events"
          ? JSON.stringify(
              (
                db.query("PRAGMA table_info(telemetry_events)").all() as {
                  cid: number;
                  name: string;
                  type: string;
                  notnull: number;
                  dflt_value: string | null;
                  pk: number;
                }[]
              )
                .map(({ cid: _cid, ...column }) => column)
                .sort((a, b) => a.name.localeCompare(b.name)),
            )
          : sql.replace(/\s+/g, " ").trim(),
    }));
  } finally {
    db.close();
  }
}

describe("zero-baseline D1 lifecycle", () => {
  it("defines one complete baseline with visit dimensions and matches fresh/reset schemas", () => {
    expect(
      readdirSync(join(d1, "migrations"))
        .filter((file) => file.endsWith(".sql"))
        .sort(),
    ).toEqual(["0001_initial_schema.sql"]);
    const baseline = sql("migrations/0001_initial_schema.sql");
    const db = new Database(":memory:");
    try {
      db.exec(baseline);
      db.exec(
        "INSERT INTO telemetry_events(path, visitor_hash) VALUES ('/new', 'visitor')",
      );
      expect(
        db
          .query(
            "SELECT path, region, os_type, browser, browser_language FROM telemetry_events",
          )
          .get(),
      ).toEqual({
        path: "/new",
        region: "unknown",
        os_type: "unknown",
        browser: "unknown",
        browser_language: "unknown",
      });
      expect(
        (db.query("PRAGMA table_info(telemetry_events)").all() as {
          name: string;
          notnull: number;
          dflt_value: string | null;
        }[])
          .filter(({ name }) =>
            ["region", "os_type", "browser", "browser_language"].includes(name),
          )
          .map(({ name, notnull, dflt_value }) => ({ name, notnull, dflt_value })),
      ).toEqual(
        ["region", "os_type", "browser", "browser_language"].map((name) => ({
          name,
          notnull: 1,
          dflt_value: "'unknown'",
        })),
      );
    } finally {
      db.close();
    }
    const fresh = objects(sql("schema.sql"));
    expect(objects(baseline)).toEqual(fresh);
    expect(objects(sql("reset.sql"))).toEqual(fresh);
    expect(baseline).toContain("bot_category TEXT");
    expect(baseline).toContain("device_desktop INTEGER NOT NULL DEFAULT 0");
  });

  it("removes stored rows without per-row deletes and restores Wrangler's baseline ledger", () => {
    const db = new Database(":memory:");
    try {
      db.exec(sql("schema.sql"));
      db.exec(`CREATE TABLE d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      INSERT INTO d1_migrations (name) VALUES
        ('0001_initial_schema.sql'), ('0011_aggregate_device_os.sql');
      INSERT INTO pageviews (path, visitor_hash) VALUES ('/fixture/', 'fixture');
      INSERT INTO contact_leads (from_email, subject, body)
        VALUES ('fixture@example.invalid', 'fixture', 'fixture');`);

      const reset = sql("reset.sql");
      expect(reset).not.toMatch(/\bDELETE\s+FROM\b/i);
      db.exec(reset);
      expect(db.query("SELECT COUNT(*) AS n FROM pageviews").get()).toEqual({
        n: 0,
      });
      expect(db.query("SELECT COUNT(*) AS n FROM contact_leads").get()).toEqual(
        {
          n: 0,
        },
      );
      expect(
        db.query("SELECT name FROM d1_migrations ORDER BY name").all(),
      ).toEqual([{ name: "0001_initial_schema.sql" }]);
      expect(
        db.query("SELECT COUNT(*) AS n FROM system_deployments").get(),
      ).toEqual({
        n: 1,
      });
    } finally {
      db.close();
    }
  });
});
