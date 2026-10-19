// ============================================================================
// Integration Test: Real Race Experiment & Consistency Replication API Routes
// ============================================================================

import { rupeesToPaise, paiseToRupees } from "./src/server/db.ts";
import { spawn, ChildProcess } from "child_process";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ TEST FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const BASE_URL = "http://127.0.0.1:3000";
let serverProcess: ChildProcess | null = null;

async function run() {
  console.log("\n============================================================");
  console.log("TESTING REAL RACE EXPERIMENT & CONSISTENCY REPLICATION APIS");
  console.log("============================================================\n");

  // Check if server is already running, otherwise launch
  let ready = false;
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (res.ok) ready = true;
  } catch {}

  if (!ready) {
    console.log("Starting server for integration testing...");
    serverProcess = spawn("npx", ["tsx", "server.ts"], {
      stdio: "pipe",
      shell: true,
      detached: false,
    });

    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  assert(ready, "Server is healthy and listening on port 3000");

  // 1. Mutex request and release with correct nodeId and algorithm
  console.log("\n--- 1. Testing Mutex Lock Request & Release Parameters ---");
  // Clean up any previously held lock and drain any pending queue
  for (let i = 0; i < 5; i++) {
    const rel = await fetch(`${BASE_URL}/api/synchronization/mutex/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId: "sender-bank" }),
    });
    const relData = await rel.json();
    if (!relData.nextHolder) break;
  }

  const mutexReq = await fetch(`${BASE_URL}/api/synchronization/mutex/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId: "sender-bank", algorithm: "Ricart-Agrawala" }),
  });
  const mutexReqData = await mutexReq.json();
  console.log("mutexReqData:", JSON.stringify(mutexReqData));
  assert(mutexReq.ok, "POST /api/synchronization/mutex/request responded HTTP 200");
  assert(mutexReqData.requestingNode === "sender-bank", "nodeId 'sender-bank' correctly recognized as requestingNode");
  assert(mutexReqData.algorithm === "Ricart-Agrawala", "Algorithm 'Ricart-Agrawala' correctly executed");
  assert(mutexReqData.granted === true, "Mutex lock granted");

  const mutexRel = await fetch(`${BASE_URL}/api/synchronization/mutex/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId: "sender-bank" }),
  });
  const mutexRelData = await mutexRel.json();
  assert(mutexRel.ok, "POST /api/synchronization/mutex/release responded HTTP 200");
  assert(mutexRelData.releasedBy === "sender-bank", "Mutex lock released by 'sender-bank'");

  // 2. Real Backend Race Experiment (Unlocked / Unsynchronized mode)
  console.log("\n--- 2. Testing Unsynchronized Race Experiment ---");
  const raceUnsyncedRes = await fetch(`${BASE_URL}/api/synchronization/race-experiment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "unlocked" }),
  });
  const raceUnsyncedData = await raceUnsyncedRes.json();
  assert(raceUnsyncedRes.ok, "POST /api/synchronization/race-experiment (unlocked) responded HTTP 200");
  assert(raceUnsyncedData.isSafe === false, "Unsynchronized mode flags anomaly (isSafe === false)");
  assert(raceUnsyncedData.initialBalance === 1000, "Initial balance was ₹1000 on test account");
  assert(raceUnsyncedData.finalBalance === 200, "Final balance is ₹200 (overdraft prevented by SQLite constraint)");
  assert(raceUnsyncedData.tx2Outcome.includes("Rejected"), "Concurrent Tx 2 was rejected on insufficient funds");

  // 3. Real Backend Race Experiment (Locked / Synchronized mode)
  console.log("\n--- 3. Testing Synchronized Race Experiment (Ricart-Agrawala Mutex) ---");
  const raceSyncedRes = await fetch(`${BASE_URL}/api/synchronization/race-experiment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "locked" }),
  });
  const raceSyncedData = await raceSyncedRes.json();
  assert(raceSyncedRes.ok, "POST /api/synchronization/race-experiment (locked) responded HTTP 200");
  assert(raceSyncedData.isSafe === true, "Synchronized mode preserves safety (isSafe === true)");
  assert(raceSyncedData.tx1Outcome.includes("Acquired Mutex"), "Tx 1 acquired Ricart-Agrawala mutex");
  assert(raceSyncedData.tx2Outcome.includes("Safely Rejected"), "Tx 2 detected insufficient balance and safely rejected");
  assert(raceSyncedData.finalBalance === 200, "Final balance is ₹200 with zero overdraft");

  // 4. Verify demo accounts were untouched
  console.log("\n--- 4. Verifying Demo Accounts Were Untouched by Race Experiment ---");
  const usersRes = await fetch(`${BASE_URL}/api/users`);
  const usersData = await usersRes.json();
  const demoSanika = usersData.users.find((u: any) => u.id === "usr_sanika" || u.upi_id === "sanika@bank");
  assert(demoSanika !== undefined, "Normal demo account Sanika intact");
  assert(demoSanika.balance >= 7000, `Sanika balance maintained without corruption: ₹${demoSanika.balance}`);

  // 5. Distributed Consistency & Replication Experiments
  console.log("\n--- 5. Testing Distributed Consistency Status & Replicas ---");
  const cStatusRes = await fetch(`${BASE_URL}/api/experiments/consistency/status`);
  const cStatusData = await cStatusRes.json();
  assert(cStatusRes.ok, "GET /api/experiments/consistency/status responded HTTP 200");
  assert(cStatusData.replicas.length === 3, "3 Data Center replicas present (Mumbai, Hyderabad, Bengaluru)");

  // Model switch to STRICT (CP)
  console.log("\n--- 6. Testing Model Switch to STRICT (CP) ---");
  const modelRes = await fetch(`${BASE_URL}/api/experiments/consistency/model`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "STRICT" }),
  });
  const modelData = await modelRes.json();
  assert(modelData.model === "STRICT", "Consistency model set to STRICT");

  // Simulate network partition
  console.log("\n--- 7. Testing Network Partition Activation ---");
  const partRes = await fetch(`${BASE_URL}/api/experiments/consistency/partition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  const partData = await partRes.json();
  assert(partData.partitioned === true, "Network partition activated");

  // Write under STRICT + Partitioned -> MUST be rejected (CP rejects writes when partitioned)
  console.log("\n--- 8. Testing CAP Rejection Under CP with Partition ---");
  const writeCpRes = await fetch(`${BASE_URL}/api/experiments/consistency/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "user_balance_usr_sanika", value: 8000, targetReplica: "dc-mumbai" }),
  });
  assert(writeCpRes.status === 503, "Write rejected with HTTP 503 under STRICT model during partition (CP preserved)");

  // Switch to EVENTUAL (AP)
  console.log("\n--- 9. Testing Eventual Consistency (AP) Under Partition ---");
  await fetch(`${BASE_URL}/api/experiments/consistency/model`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "EVENTUAL" }),
  });
  const writeApRes = await fetch(`${BASE_URL}/api/experiments/consistency/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "user_balance_usr_sanika", value: 7500, targetReplica: "dc-mumbai" }),
  });
  const writeApData = await writeApRes.json();
  assert(writeApRes.ok, "Write accepted locally under EVENTUAL model during partition (AP preserved)");
  assert(writeApData.value === 7500, "Value updated on target replica dc-mumbai");

  // Heal partition
  console.log("\n--- 10. Testing Partition Healing & Reconciliation ---");
  await fetch(`${BASE_URL}/api/experiments/consistency/partition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });

  // Reconcile
  const reconRes = await fetch(`${BASE_URL}/api/experiments/consistency/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy: "LAST_WRITE_WINS" }),
  });
  const reconData = await reconRes.json();
  assert(reconRes.ok, "POST /api/experiments/consistency/reconcile responded HTTP 200");
  assert(reconData.strategy === "LAST_WRITE_WINS", "Reconciled with Last-Write-Wins strategy");

  // Reset
  console.log("\n--- 11. Testing Cluster Reset ---");
  const resetRes = await fetch(`${BASE_URL}/api/experiments/consistency/reset`, {
    method: "POST",
  });
  const resetData = await resetRes.json();
  assert(resetRes.ok, "POST /api/experiments/consistency/reset responded HTTP 200");
  assert(resetData.success === true, "Cluster reset to clean baseline");

  console.log("\n============================================================");
  console.log("ALL INTEGRATION TESTS PASSED WITH 100% SUCCESS!");
  console.log("============================================================\n");
}

function cleanupServer() {
  if (serverProcess && serverProcess.pid) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(serverProcess.pid), "/f", "/t"]);
      } else {
        serverProcess.kill("SIGTERM");
      }
    } catch {}
  }
}

run()
  .then(() => {
    cleanupServer();
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test failed:", err);
    cleanupServer();
    process.exit(1);
  });
