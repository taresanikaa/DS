// ============================================================================
// Integration Test: Real Race Experiment & Consistency Replication API Routes
// ============================================================================

import { rupeesToPaise, paiseToRupees, db, persistentDb } from "./src/server/db.ts";
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

  // 12. Financial Validation & Monetary Precision Boundaries
  console.log("\n--- 12. Testing Live API Financial Validation & Monetary Precision Boundaries ---");
  
  // Non-number / boolean rejection
  const boolRes = await fetch(`${BASE_URL}/api/transaction/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderId: "user1@upi", receiverId: "user2@upi", amount: true, idempotencyKey: `IDEM-BOOL-${Date.now()}` }),
  });
  assert(boolRes.status === 400, "Boolean amount { amount: true } rejected with HTTP 400 Bad Request");

  // NaN string rejection
  const nanRes = await fetch(`${BASE_URL}/api/transaction/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderId: "user1@upi", receiverId: "user2@upi", amount: "not_a_number", idempotencyKey: `IDEM-NAN-${Date.now()}` }),
  });
  assert(nanRes.status === 400, "Malformed string amount rejected with HTTP 400 Bad Request");

  // Zero amount rejection
  const zeroRes = await fetch(`${BASE_URL}/api/transaction/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderId: "user1@upi", receiverId: "user2@upi", amount: 0, idempotencyKey: `IDEM-ZERO-${Date.now()}` }),
  });
  assert(zeroRes.status === 400, "Zero amount transfer rejected with HTTP 400 Bad Request");

  // Negative amount rejection
  const negRes = await fetch(`${BASE_URL}/api/transaction/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderId: "user1@upi", receiverId: "user2@upi", amount: -150, idempotencyKey: `IDEM-NEG-${Date.now()}` }),
  });
  assert(negRes.status === 400, "Negative amount transfer rejected with HTTP 400 Bad Request");

  // Sub-paise fractional decimal rejection (e.g. 10.555)
  const fracRes = await fetch(`${BASE_URL}/api/transaction/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderId: "user1@upi", receiverId: "user2@upi", amount: 10.555, idempotencyKey: `IDEM-FRAC-${Date.now()}` }),
  });
  assert(fracRes.status === 400, "Sub-paise fractional decimal amount (10.555) rejected with HTTP 400 Bad Request");

  // Self-transfer rejection
  const selfRes = await fetch(`${BASE_URL}/api/transaction/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderId: "user1@upi", receiverId: "user1@upi", amount: 50, idempotencyKey: `IDEM-SELF-${Date.now()}` }),
  });
  assert(selfRes.status === 400, "Self-transfer (sender === receiver) rejected with HTTP 400 Bad Request");

  // Unknown sender account rejection
  const unkRes = await fetch(`${BASE_URL}/api/transaction/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderId: "ghost_vpa@randombank", receiverId: "user2@upi", amount: 50, idempotencyKey: `IDEM-UNK-${Date.now()}` }),
  });
  assert(unkRes.status === 400, "Unknown account transfer rejected with HTTP 400 Bad Request");

  // 13. Live API High-Concurrency Idempotency Test
  console.log("\n--- 13. Testing Live API High-Concurrency Idempotency Under Parallel Stress ---");
  const testKey = `IDEM-CONCUR-PARALLEL-${Date.now()}`;
  const u1PreRes = await fetch(`${BASE_URL}/api/users`);
  const u1PreData = await u1PreRes.json();
  const u1PreBal = u1PreData.users.find((u: any) => u.upi_id === "user1@upi")!.balance;
  const u2PreBal = u1PreData.users.find((u: any) => u.upi_id === "user2@upi")!.balance;

  const parallelReqs = Array.from({ length: 5 }, () =>
    fetch(`${BASE_URL}/api/transaction/initiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderId: "user1@upi",
        receiverId: "user2@upi",
        amount: 100,
        idempotencyKey: testKey,
        mode: "rest",
      }),
    })
  );

  const parallelResponses = await Promise.all(parallelReqs);
  const parallelData = await Promise.all(parallelResponses.map((r) => r.json()));

  // All 5 must succeed with 200 OK
  for (const r of parallelResponses) {
    assert(r.ok, "Parallel idempotency request returned HTTP 200 OK");
  }

  // All 5 must return the exact same transaction ID
  const firstTxnId = parallelData[0].transactionId;
  assert(Boolean(firstTxnId), "Valid transactionId returned from parallel requests");
  for (const d of parallelData) {
    assert(d.transactionId === firstTxnId, `All parallel responses returned matching transactionId ${firstTxnId}`);
  }

  // Check sender balance debited exactly once
  const u1PostRes = await fetch(`${BASE_URL}/api/users`);
  const u1PostData = await u1PostRes.json();
  const u1PostBal = u1PostData.users.find((u: any) => u.upi_id === "user1@upi")!.balance;
  const u2PostBal = u1PostData.users.find((u: any) => u.upi_id === "user2@upi")!.balance;

  assert(u1PostBal === u1PreBal - 100, `Sender balance was debited exactly once (₹${u1PreBal} -> ₹${u1PostBal}) despite 5 simultaneous requests`);
  assert(u2PostBal === u2PreBal + 100, `Receiver balance was credited exactly once (₹${u2PreBal} -> ₹${u2PostBal}) despite 5 simultaneous requests`);

  // 14. Live API Idempotency Conflict Detection
  console.log("\n--- 14. Testing Live API Idempotency Conflict Detection ---");
  const conflictAmtRes = await fetch(`${BASE_URL}/api/transaction/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      senderId: "user1@upi",
      receiverId: "user2@upi",
      amount: 999, // altered amount
      idempotencyKey: testKey,
      mode: "rest",
    }),
  });
  const conflictAmtData = await conflictAmtRes.json();
  assert(conflictAmtRes.status === 409, "Reusing key with altered amount returns HTTP 409 Conflict");
  assert(conflictAmtData.code === "IDEMPOTENCY_CONFLICT", "Conflict error code IDEMPOTENCY_CONFLICT returned");

  const conflictRcvRes = await fetch(`${BASE_URL}/api/transaction/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      senderId: "user1@upi",
      receiverId: "rahul@bank", // altered receiver
      amount: 100,
      idempotencyKey: testKey,
      mode: "rest",
    }),
  });
  const conflictRcvData = await conflictRcvRes.json();
  assert(conflictRcvRes.status === 409, "Reusing key with altered receiver returns HTTP 409 Conflict");
  assert(conflictRcvData.code === "IDEMPOTENCY_CONFLICT", "Conflict error code IDEMPOTENCY_CONFLICT returned");

  // 15. Double-Entry Ledger Parity & Money Conservation Check
  console.log("\n--- 15. Testing Double-Entry Ledger Parity & Closed-System Money Conservation ---");
  const inv = persistentDb.getLedgerInvariants();
  assert(inv.debitCreditParity === true, "Ledger debits match ledger credits across all transactions");
  assert(inv.isConservationPreserved === true, "Closed-system money conservation strictly preserved (total == genesis)");

  // Clean up parallel test records to restore pristine baseline
  try {
    db.prepare("DELETE FROM sender_debits WHERE transaction_id = ?").run(firstTxnId);
    db.prepare("DELETE FROM receiver_credits WHERE transaction_id = ?").run(firstTxnId);
    db.prepare("DELETE FROM ledger_entries WHERE transaction_id = ?").run(firstTxnId);
    db.prepare("DELETE FROM transactions WHERE transaction_id = ?").run(firstTxnId);
    db.prepare("DELETE FROM idempotency_records WHERE key = ?").run(testKey);
    db.prepare("UPDATE accounts SET balance_paise = ? WHERE upi_id = 'user1@upi'").run(rupeesToPaise(u1PreBal));
    db.prepare("UPDATE accounts SET balance_paise = ? WHERE upi_id = 'user2@upi'").run(rupeesToPaise(u2PreBal));
  } catch {}

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
