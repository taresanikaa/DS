// Live Docker / Kubernetes verification for the UPI simulator.
// Static checks stay in test_unit4_deployment.ts.
// This script never runs `docker compose down -v`.

import { execSync, spawnSync } from "child_process";
import { randomUUID } from "crypto";

type CheckStatus = "PASSED" | "FAILED" | "SKIPPED";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, status: CheckStatus, detail: string) {
  results.push({ name, status, detail });
  const tag = status === "PASSED" ? "PASS" : status === "FAILED" ? "FAIL" : "SKIP";
  console.log(`[${tag}] ${name}: ${detail}`);
}

function commandExists(command: string): boolean {
  const probe = process.platform === "win32" ? `where ${command}` : `which ${command}`;
  const res = spawnSync(probe, { shell: true, encoding: "utf-8" });
  return res.status === 0;
}

function run(command: string, timeoutMs = 120000): { ok: boolean; output: string } {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (err: any) {
    const output = `${err?.stdout || ""}${err?.stderr || err?.message || err}`;
    return { ok: false, output };
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await sleep(2000);
  }
  return false;
}

async function verifyComposePersistence(): Promise<void> {
  if (!commandExists("docker")) {
    record("docker-compose-persistence", "SKIPPED", "Docker CLI is not on PATH");
    return;
  }

  const version = run("docker version");
  if (!version.ok) {
    record("docker-daemon", "SKIPPED", `Docker CLI is present but the daemon is unavailable: ${version.output.slice(0, 300)}`);
    record("docker-compose-persistence", "SKIPPED", "Cannot run Compose persistence without a Docker daemon");
    return;
  }
  record("docker-daemon", "PASSED", "Docker daemon responded to docker version");

  const cfg = run("docker compose -f compose.yaml config");
  if (!cfg.ok) {
    record("compose-config", "FAILED", cfg.output.slice(0, 500));
    return;
  }
  record("compose-config", "PASSED", "compose.yaml is valid");

  const build = run("docker compose -f compose.yaml build", 600000);
  if (!build.ok) {
    record("compose-build", "FAILED", build.output.slice(-1500));
    return;
  }
  record("compose-build", "PASSED", "upi-simulator image built");

  const up = run("docker compose -f compose.yaml up -d --wait", 180000);
  if (!up.ok) {
    const logs = run("docker compose -f compose.yaml logs --no-color --tail=80");
    record("compose-up", "FAILED", `${up.output.slice(-800)}\n${logs.output.slice(-800)}`);
    return;
  }
  record("compose-up", "PASSED", "Compose service started");

  const healthy = await waitForHttp("http://127.0.0.1:3000/health", 60000);
  if (!healthy) {
    const logs = run("docker compose -f compose.yaml logs --no-color --tail=80");
    record("compose-health", "FAILED", `GET /health did not become ready\n${logs.output.slice(-800)}`);
    run("docker compose -f compose.yaml down");
    return;
  }
  record("compose-health", "PASSED", "GET /health returned HTTP 2xx");

  const idempotencyKey = `persist-${randomUUID()}`;
  let transactionId = "";
  try {
    const created = await fetch("http://127.0.0.1:3000/api/transaction/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderId: "sanika@bank",
        receiverId: "navya@bank",
        amount: 17,
        idempotencyKey,
        mode: "rest",
      }),
    });
    const body = await created.json();
    transactionId = body.transactionId || body.transaction_id || "";
    if (!created.ok || !transactionId) {
      record("compose-create-transaction", "FAILED", `HTTP ${created.status} ${JSON.stringify(body)}`);
      run("docker compose -f compose.yaml down");
      return;
    }
    record("compose-create-transaction", "PASSED", `Created ${transactionId}`);
  } catch (err: any) {
    record("compose-create-transaction", "FAILED", String(err?.message || err));
    run("docker compose -f compose.yaml down");
    return;
  }

  const restart = run("docker compose -f compose.yaml restart upi-simulator");
  if (!restart.ok) {
    record("compose-restart", "FAILED", restart.output.slice(-500));
    run("docker compose -f compose.yaml down");
    return;
  }
  const healthyAfterRestart = await waitForHttp("http://127.0.0.1:3000/health", 60000);
  if (!healthyAfterRestart) {
    record("compose-restart", "FAILED", "Service did not become healthy after restart");
    run("docker compose -f compose.yaml down");
    return;
  }

  const afterRestart = await fetch(`http://127.0.0.1:3000/api/transaction/${transactionId}/status`);
  const afterRestartBody = await afterRestart.json();
  if (!afterRestart.ok) {
    record("compose-persist-after-restart", "FAILED", JSON.stringify(afterRestartBody));
    run("docker compose -f compose.yaml down");
    return;
  }
  record("compose-persist-after-restart", "PASSED", `Transaction ${transactionId} survived container restart`);

  const recreate = run("docker compose -f compose.yaml up -d --force-recreate --wait", 180000);
  if (!recreate.ok) {
    record("compose-recreate", "FAILED", recreate.output.slice(-800));
    run("docker compose -f compose.yaml down");
    return;
  }
  const healthyAfterRecreate = await waitForHttp("http://127.0.0.1:3000/health", 60000);
  if (!healthyAfterRecreate) {
    record("compose-recreate", "FAILED", "Service did not become healthy after recreate");
    run("docker compose -f compose.yaml down");
    return;
  }
  const afterRecreate = await fetch(`http://127.0.0.1:3000/api/transaction/${transactionId}/status`);
  const afterRecreateBody = await afterRecreate.json();
  if (!afterRecreate.ok) {
    record("compose-persist-after-recreate", "FAILED", JSON.stringify(afterRecreateBody));
    run("docker compose -f compose.yaml down");
    return;
  }
  record("compose-persist-after-recreate", "PASSED", `Transaction ${transactionId} survived container recreate (volume kept)`);

  const ps = run("docker compose -f compose.yaml ps");
  record("compose-ps", ps.ok ? "PASSED" : "FAILED", ps.output.slice(0, 400));

  const down = run("docker compose -f compose.yaml down");
  record("compose-down-keep-volume", down.ok ? "PASSED" : "FAILED", "Stopped stack without -v so upi_simulator_data remains");
}

async function verifyKubernetes(): Promise<void> {
  if (!commandExists("kubectl")) {
    record("kubernetes-live", "SKIPPED", "kubectl is not on PATH");
    return;
  }

  const dry = run("kubectl apply -k k8s/ --dry-run=client");
  if (!dry.ok) {
    record("kubectl-dry-run", "FAILED", dry.output.slice(-800));
  } else {
    record("kubectl-dry-run", "PASSED", "Client-side kustomize apply succeeded");
  }

  const cluster = run("kubectl cluster-info", 8000);
  if (!cluster.ok) {
    record("kubernetes-live", "SKIPPED", "No reachable Kubernetes cluster. Remaining steps: load the image, kubectl apply -k k8s/, wait for rollout, create a transaction, delete the pod, confirm persistence.");
    return;
  }

  record("kubernetes-cluster", "PASSED", "kubectl cluster-info succeeded");
  const apply = run("kubectl apply -k k8s/", 60000);
  if (!apply.ok) {
    record("kubernetes-apply", "FAILED", apply.output.slice(-800));
    return;
  }
  record("kubernetes-apply", "PASSED", apply.output.slice(0, 400));

  const rollout = run("kubectl -n upi-simulator rollout status deployment/upi-simulator --timeout=180s", 200000);
  if (!rollout.ok) {
    const describe = run("kubectl -n upi-simulator describe deployment/upi-simulator");
    const pods = run("kubectl -n upi-simulator get pods -o wide");
    record("kubernetes-rollout", "FAILED", `${rollout.output}\n${pods.output}\n${describe.output}`.slice(0, 1500));
    return;
  }
  record("kubernetes-rollout", "PASSED", "Deployment rollout completed");

  const pvc = run("kubectl -n upi-simulator get pvc upi-data-pvc");
  record("kubernetes-pvc", pvc.ok ? "PASSED" : "FAILED", pvc.output.slice(0, 400));
}

async function main() {
  console.log("UPI simulator infrastructure verification");
  console.log("Static unit tests are not skipped here; this script is the live layer.\n");

  await verifyComposePersistence();
  await verifyKubernetes();

  console.log("\n==== Verification summary ====");
  for (const item of results) {
    console.log(`${item.status.padEnd(8)} ${item.name}`);
  }

  const failed = results.filter((item) => item.status === "FAILED");
  if (failed.length > 0) {
    console.error(`\n${failed.length} live check(s) failed.`);
    process.exit(1);
  }
  console.log("\nNo live check failed. SKIPPED items are environment limitations, not silent passes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
