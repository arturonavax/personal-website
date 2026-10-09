import { describe, expect, it } from "bun:test";
import { DeploymentRegistry } from "../src/lib/adapters";

describe("DeploymentRegistry", () => {
  it("should return fallback active deployment when DB is undefined", async () => {
    const registry = new DeploymentRegistry(undefined);
    const deployment = await registry.getActiveDeployment();

    expect(deployment).not.toBeNull();
    expect(deployment?.releaseVersion).toBe("1.0.0-spec-unified");
    expect(deployment?.workerName).toBe("personal-website");
    expect(deployment?.status).toBe("active");
  });

  it("should query D1 database when DB is provided", async () => {
    const mockRow = {
      id: 42,
      release_version: "2.0.0",
      worker_name: "personal-website",
      git_commit: "abc1234",
      deployed_at: "2026-10-09 00:00:00",
      environment: "production",
      status: "active" as const,
      compatibility_date: "2026-09-26",
      metadata: '{"ok":true}',
    };

    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => mockRow,
          all: async () => ({ results: [mockRow] }),
          run: async () => ({ meta: { last_row_id: 43 } }),
        }),
        first: async () => mockRow,
        all: async () => ({ results: [mockRow] }),
        run: async () => ({ meta: { last_row_id: 43 } }),
      }),
    } as unknown as D1Database;

    const registry = new DeploymentRegistry(mockDb);
    const deployment = await registry.getActiveDeployment();

    expect(deployment).not.toBeNull();
    expect(deployment?.id).toBe(42);
    expect(deployment?.releaseVersion).toBe("2.0.0");
    expect(deployment?.status).toBe("active");
  });

  it("should list deployments from D1 database", async () => {
    const mockRows = [
      {
        id: 2,
        release_version: "1.0.1",
        worker_name: "personal-website",
        git_commit: "commit2",
        deployed_at: "2026-10-09 01:00:00",
        environment: "production",
        status: "active" as const,
        compatibility_date: "2026-09-26",
        metadata: "{}",
      },
      {
        id: 1,
        release_version: "1.0.0",
        worker_name: "personal-website",
        git_commit: "commit1",
        deployed_at: "2026-10-08 23:00:00",
        environment: "production",
        status: "deprecated" as const,
        compatibility_date: "2026-09-26",
        metadata: "{}",
      },
    ];

    const mockDb = {
      prepare: (_sql: string) => ({
        bind: (..._args: unknown[]) => ({
          all: async () => ({ results: mockRows }),
        }),
        all: async () => ({ results: mockRows }),
      }),
    } as unknown as D1Database;

    const registry = new DeploymentRegistry(mockDb);
    const list = await registry.listDeployments(5);

    expect(list.length).toBe(2);
    expect(list[0].releaseVersion).toBe("1.0.1");
    expect(list[1].status).toBe("deprecated");
  });
});
