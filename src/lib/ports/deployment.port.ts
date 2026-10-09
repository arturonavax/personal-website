export interface SystemDeploymentRecord {
  readonly id?: number;
  readonly releaseVersion: string;
  readonly workerName: string;
  readonly gitCommit?: string | undefined;
  readonly deployedAt: string;
  readonly environment: string;
  readonly status: "active" | "deprecated" | "rollback";
  readonly compatibilityDate?: string | undefined;
  readonly metadata?: string | undefined;
}

export interface DeploymentRegistryPort {
  getActiveDeployment(): Promise<SystemDeploymentRecord | null>;
  recordDeployment(
    record: Omit<SystemDeploymentRecord, "id" | "deployedAt">,
  ): Promise<number>;
  listDeployments(limit?: number): Promise<SystemDeploymentRecord[]>;
}
