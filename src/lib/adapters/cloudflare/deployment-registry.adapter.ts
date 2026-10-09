/// <reference types="@cloudflare/workers-types" />
import type {
  DeploymentRegistryPort,
  SystemDeploymentRecord,
} from "../../ports/deployment.port";

export class DeploymentRegistry implements DeploymentRegistryPort {
  constructor(private readonly db?: D1Database | undefined) {}

  async getActiveDeployment(): Promise<SystemDeploymentRecord | null> {
    if (!this.db) {
      return {
        releaseVersion: "1.0.0-spec-unified",
        workerName: "personal-website",
        gitCommit: "1a7843d",
        deployedAt: new Date().toISOString(),
        environment: "production",
        status: "active",
        compatibilityDate: "2026-09-26",
        metadata: JSON.stringify({
          subsystems: {
            d1_migrations: ["0001", "0002", "0003", "0004", "0005", "0006"],
            vectorize_index: "knowledge-embeddings",
            prefetch_circuit_breaker: true,
            edge_ssg: true,
          },
        }),
      };
    }

    try {
      const row = await this.db
        .prepare(
          `SELECT id, release_version, worker_name, git_commit, deployed_at, environment, status, compatibility_date, metadata
           FROM system_deployments
           WHERE status = 'active'
           ORDER BY deployed_at DESC
           LIMIT 1`,
        )
        .first<{
          id: number;
          release_version: string;
          worker_name: string;
          git_commit: string | null;
          deployed_at: string;
          environment: string;
          status: "active" | "deprecated" | "rollback";
          compatibility_date: string | null;
          metadata: string | null;
        }>();

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        releaseVersion: row.release_version,
        workerName: row.worker_name,
        gitCommit: row.git_commit ?? undefined,
        deployedAt: row.deployed_at,
        environment: row.environment,
        status: row.status,
        compatibilityDate: row.compatibility_date ?? undefined,
        metadata: row.metadata ?? undefined,
      };
    } catch (err) {
      console.error("[DeploymentRegistry:getActiveDeployment Error]", err);
      return null;
    }
  }

  async recordDeployment(
    record: Omit<SystemDeploymentRecord, "id" | "deployedAt">,
  ): Promise<number> {
    if (!this.db) {
      return 1;
    }

    try {
      // Mark previous active deployments as deprecated
      await this.db
        .prepare(
          `UPDATE system_deployments SET status = 'deprecated' WHERE status = 'active'`,
        )
        .run();

      const result = await this.db
        .prepare(
          `INSERT INTO system_deployments (
             release_version, worker_name, git_commit, environment, status, compatibility_date, metadata, deployed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
        .bind(
          record.releaseVersion,
          record.workerName,
          record.gitCommit ?? null,
          record.environment,
          record.status,
          record.compatibilityDate ?? null,
          record.metadata ?? null,
        )
        .run();

      return Number(result.meta?.last_row_id || 0);
    } catch (err) {
      console.error("[DeploymentRegistry:recordDeployment Error]", err);
      throw err;
    }
  }

  async listDeployments(limit = 10): Promise<SystemDeploymentRecord[]> {
    if (!this.db) {
      const fallback = await this.getActiveDeployment();
      return fallback ? [fallback] : [];
    }

    try {
      const rows = await this.db
        .prepare(
          `SELECT id, release_version, worker_name, git_commit, deployed_at, environment, status, compatibility_date, metadata
           FROM system_deployments
           ORDER BY deployed_at DESC
           LIMIT ?`,
        )
        .bind(limit)
        .all<{
          id: number;
          release_version: string;
          worker_name: string;
          git_commit: string | null;
          deployed_at: string;
          environment: string;
          status: "active" | "deprecated" | "rollback";
          compatibility_date: string | null;
          metadata: string | null;
        }>();

      return (rows.results || []).map((row) => ({
        id: row.id,
        releaseVersion: row.release_version,
        workerName: row.worker_name,
        gitCommit: row.git_commit ?? undefined,
        deployedAt: row.deployed_at,
        environment: row.environment,
        status: row.status,
        compatibilityDate: row.compatibility_date ?? undefined,
        metadata: row.metadata ?? undefined,
      }));
    } catch (err) {
      console.error("[DeploymentRegistry:listDeployments Error]", err);
      return [];
    }
  }
}
