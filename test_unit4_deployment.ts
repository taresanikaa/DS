// ============================================================================
// UNIT IV — Containerization, Orchestration & SQLite-safe Deployment
// Static validation of Dockerfile, Compose, and Kubernetes manifests.
// Live Docker/Kubernetes checks are executed by scripts/verify_infra.ts.
// ============================================================================

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

interface TestMetrics {
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
}

const metrics: TestMetrics = {
  totalAssertions: 0,
  passedAssertions: 0,
  failedAssertions: 0,
};

function assertCondition(condition: boolean, message: string) {
  metrics.totalAssertions++;
  if (condition) {
    metrics.passedAssertions++;
    console.log(`  [PASS] ${message}`);
  } else {
    metrics.failedAssertions++;
    console.error(`  [FAIL] ${message}`);
  }
}

function commandExists(command: string): boolean {
  try {
    execSync(process.platform === "win32" ? `where ${command}` : `which ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function runUnit4DeploymentTests(): Promise<boolean> {
  console.log("\n" + "=".repeat(100));
  console.log("UNIT IV: Containerization, Orchestration & SQLite-safe Deployment Validation");
  console.log("=".repeat(100) + "\n");

  console.log("[TEST 1/6] Docker multi-stage image definition");
  const dockerfilePath = path.resolve("./Dockerfile");
  const dockerfileExists = fs.existsSync(dockerfilePath);
  assertCondition(dockerfileExists, "Dockerfile exists at repository root");
  const dockerfileContent = dockerfileExists ? fs.readFileSync(dockerfilePath, "utf-8") : "";

  assertCondition(
    dockerfileContent.includes("AS builder") && dockerfileContent.includes("AS runner"),
    "Dockerfile uses builder and runner stages"
  );
  assertCondition(dockerfileContent.includes("node:22-alpine"), "Dockerfile uses node:22-alpine");
  assertCondition(dockerfileContent.includes("npm ci"), "Builder installs from the npm lockfile via npm ci");
  assertCondition(dockerfileContent.includes("npm ci --omit=dev"), "Runner omits development dependencies");
  assertCondition(dockerfileContent.includes("USER node"), "Runtime user is unprivileged node");
  assertCondition(dockerfileContent.includes("HEALTHCHECK") && dockerfileContent.includes("/health"), "HEALTHCHECK probes GET /health");
  assertCondition(dockerfileContent.includes("dumb-init"), "dumb-init is PID 1 for SIGTERM forwarding");
  assertCondition(
    dockerfileContent.includes("--experimental-sqlite") && dockerfileContent.includes("tsx"),
    "Production CMD runs TypeScript via tsx with Node SQLite enabled"
  );
  assertCondition(
    !/password\s*=/i.test(dockerfileContent) && !dockerfileContent.includes("upi_token_live"),
    "Dockerfile contains no hardcoded credentials"
  );

  console.log("\n[TEST 2/6] Docker Compose persistence and health");
  const composePath = path.resolve("./compose.yaml");
  assertCondition(fs.existsSync(composePath), "compose.yaml exists");
  const composeContent = fs.readFileSync(composePath, "utf-8");
  assertCondition(composeContent.includes("upi_data:/app/data"), "Compose mounts named volume at /app/data");
  assertCondition(composeContent.includes("SQLITE_DB_PATH: /app/data/upi_simulator.db"), "Compose points SQLite at the volume path");
  assertCondition(composeContent.includes("127.0.0.1:3000/health"), "Compose healthcheck uses the real /health endpoint");
  assertCondition(composeContent.includes("wget"), "Compose healthcheck uses wget, which is installed in the image");
  assertCondition(!composeContent.includes("curl"), "Compose healthcheck does not require curl");
  assertCondition(composeContent.includes("stop_grace_period: 30s"), "Compose allows graceful shutdown");

  const dockerignore = fs.existsSync("./.dockerignore") ? fs.readFileSync("./.dockerignore", "utf-8") : "";
  assertCondition(dockerignore.includes("node_modules") && dockerignore.includes(".env"), ".dockerignore excludes node_modules and .env");

  const envExample = fs.existsSync("./.env.example") ? fs.readFileSync("./.env.example", "utf-8") : "";
  assertCondition(envExample.includes("SQLITE_DB_PATH=") && envExample.includes("change-me"), ".env.example documents placeholders, not live secrets");

  console.log("\n[TEST 3/6] Kubernetes writer Deployment (single SQLite replica)");
  const deploymentPath = path.resolve("./k8s/deployment.yaml");
  assertCondition(fs.existsSync(deploymentPath), "k8s/deployment.yaml exists");
  const deploymentContent = fs.readFileSync(deploymentPath, "utf-8");
  assertCondition(
    deploymentContent.includes("apiVersion: apps/v1") && deploymentContent.includes("kind: Deployment"),
    "Deployment uses apps/v1"
  );
  assertCondition(
    /replicas:\s*1\b/.test(deploymentContent),
    "Authoritative SQLite writer is pinned to 1 replica"
  );
  assertCondition(
    deploymentContent.includes("type: Recreate"),
    "Recreate strategy avoids dual-mount of the ReadWriteOnce SQLite PVC"
  );
  assertCondition(
    !deploymentContent.includes("type: RollingUpdate"),
    "Writer Deployment does not use RollingUpdate against RWO SQLite storage"
  );
  assertCondition(
    deploymentContent.includes("runAsNonRoot: true") && deploymentContent.includes("allowPrivilegeEscalation: false"),
    "Pod runs as non-root without privilege escalation"
  );
  assertCondition(deploymentContent.includes("readOnlyRootFilesystem: true"), "Root filesystem is read-only");
  assertCondition(deploymentContent.includes("drop:") && deploymentContent.includes("- ALL"), "All capabilities are dropped");
  assertCondition(
    deploymentContent.includes('cpu: "100m"') &&
      deploymentContent.includes('memory: "128Mi"') &&
      deploymentContent.includes('cpu: "500m"') &&
      deploymentContent.includes('memory: "512Mi"'),
    "CPU and memory requests/limits are set"
  );
  assertCondition(
    deploymentContent.includes("startupProbe:") &&
      deploymentContent.includes("livenessProbe:") &&
      deploymentContent.includes("readinessProbe:"),
    "Startup, liveness, and readiness probes are configured"
  );
  assertCondition(
    deploymentContent.includes("path: /health") && deploymentContent.includes("port: 3000"),
    "Probes target HTTP GET /health on port 3000"
  );
  assertCondition(
    deploymentContent.includes("mountPath: /app/data") && deploymentContent.includes("claimName: upi-data-pvc"),
    "SQLite directory is the upi-data-pvc mount"
  );
  assertCondition(deploymentContent.includes("containerPort: 50051"), "gRPC port 50051 is declared");

  console.log("\n[TEST 4/6] Service, PVC, PDB, and kustomize production set");
  const serviceContent = fs.readFileSync("./k8s/service.yaml", "utf-8");
  assertCondition(
    serviceContent.includes("kind: Service") && serviceContent.includes("type: ClusterIP"),
    "Service is ClusterIP (portable; use port-forward or an Ingress in the target cluster)"
  );
  assertCondition(serviceContent.includes("targetPort: 3000") && serviceContent.includes("targetPort: 50051"), "Service exposes HTTP 3000 and gRPC 50051");

  const pvcContent = fs.readFileSync("./k8s/pvc.yaml", "utf-8");
  assertCondition(
    pvcContent.includes("ReadWriteOnce") && pvcContent.includes("storage: 1Gi"),
    "PVC is ReadWriteOnce 1Gi for a single SQLite writer"
  );

  const pdbContent = fs.readFileSync("./k8s/pdb.yaml", "utf-8");
  assertCondition(
    pdbContent.includes("maxUnavailable: 1"),
    "PDB allows the single replica to be evicted instead of blocking node drains"
  );

  const kustomizeContent = fs.readFileSync("./k8s/kustomization.yaml", "utf-8");
  assertCondition(
    kustomizeContent.includes("deployment.yaml") &&
      kustomizeContent.includes("service.yaml") &&
      kustomizeContent.includes("configmap.yaml") &&
      kustomizeContent.includes("secret.yaml") &&
      kustomizeContent.includes("pvc.yaml") &&
      kustomizeContent.includes("pdb.yaml") &&
      kustomizeContent.includes("namespace.yaml"),
    "Kustomization applies the live writer resources"
  );
  assertCondition(
    !kustomizeContent.includes("hpa.yaml") &&
      !kustomizeContent.includes("statefulset.yaml") &&
      !kustomizeContent.includes("headless-service.yaml"),
    "Kustomization does not apply HPA or extra SQLite-writer replicas"
  );

  console.log("\n[TEST 5/6] Secrets and HPA files remain placeholders / examples");
  const secretContent = fs.readFileSync("./k8s/secret.yaml", "utf-8");
  assertCondition(secretContent.includes("kind: Secret") && secretContent.includes("change-me"), "Secret uses placeholders, not live tokens");
  assertCondition(!secretContent.includes("upi_token_live") && !secretContent.includes("aes256_gcm_sqlite_cipher_key"), "Secret does not commit simulated production credentials");

  const hpaContent = fs.readFileSync("./k8s/hpa.yaml", "utf-8");
  assertCondition(hpaContent.includes("minReplicas: 1") && hpaContent.includes("maxReplicas: 1"), "Example HPA cannot scale the SQLite writer above 1");
  assertCondition(hpaContent.includes("selectPolicy: Disabled"), "Example HPA disables scale-up");

  const statefulSetContent = fs.readFileSync("./k8s/statefulset.yaml", "utf-8");
  assertCondition(
    statefulSetContent.includes("NOT APPLIED"),
    "StatefulSet file is marked as an educational example, not a live extra writer cluster"
  );

  console.log("\n[TEST 6/6] Tooling availability (honest, not a fake pass of live deploy)");
  const dockerAvailable = commandExists("docker");
  const kubectlAvailable = commandExists("kubectl");
  let clusterAvailable = false;
  if (kubectlAvailable) {
    try {
      execSync("kubectl cluster-info", { stdio: "ignore", timeout: 4000 });
      clusterAvailable = true;
    } catch {}
  }

  console.log(`  - Docker CLI available:     ${dockerAvailable ? "YES" : "NO"}`);
  console.log(`  - Kubectl CLI available:    ${kubectlAvailable ? "YES" : "NO"}`);
  console.log(`  - Active K8s Cluster:       ${clusterAvailable ? "CONNECTED" : "NOT DETECTED"}`);
  assertCondition(true, "Environment capability probe completed (live deploy is a separate verify_infra step)");

  if (dockerAvailable) {
    try {
      execSync("docker compose -f compose.yaml config", { stdio: "pipe" });
      assertCondition(true, "docker compose config validates compose.yaml");
    } catch (err: any) {
      assertCondition(false, `docker compose config failed: ${err?.message || err}`);
    }
  } else {
    console.log("  [SKIP] docker compose config — Docker CLI not on PATH");
  }

  if (kubectlAvailable) {
    try {
      execSync("kubectl apply -k k8s/ --dry-run=client", { stdio: "pipe" });
      assertCondition(true, "kubectl kustomize client dry-run succeeded");
    } catch (err: any) {
      assertCondition(false, `kubectl dry-run failed: ${err?.message || err}`);
    }
  } else {
    console.log("  [SKIP] kubectl --dry-run=client — kubectl not on PATH");
  }

  console.log("\n" + "=".repeat(100));
  console.log("UNIT IV STATIC VALIDATION REPORT");
  console.log("=".repeat(100));
  console.log(`Total Assertions Evaluated:    ${metrics.totalAssertions}`);
  console.log(`Passed Assertions:             ${metrics.passedAssertions}`);
  console.log(`Failed Assertions:             ${metrics.failedAssertions}`);
  console.log("=".repeat(100));

  const success = metrics.failedAssertions === 0;
  if (success) {
    console.log("RESULT: STATIC UNIT IV INVARIANTS SATISFIED\n");
  } else {
    console.error("RESULT: ONE OR MORE STATIC INVARIANTS FAILED\n");
  }
  return success;
}

if (process.argv[1]?.includes("test_unit4_deployment.ts")) {
  runUnit4DeploymentTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error("Unhandled test suite error:", err);
      process.exit(1);
    });
}
