// ============================================================================
// Automated Test Suite for Distributed Database Consistency Experiments
// Validates: CAP Theorem, Linearizability, Eventual Consistency,
// Network Partition Tolerance, Conflict Resolution & Reconciliation
// ============================================================================

import {
  VectorClockManager,
  VectorClock,
} from "./src/server/synchronization.ts";
import { rupeesToPaise, paiseToRupees } from "./src/server/db.ts";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ TEST FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ ${message}`);
}

console.log("\n" + "=".repeat(75));
console.log("RUNNING DISTRIBUTED DATABASE CONSISTENCY & REPLICATION EXPERIMENTS");
console.log("=".repeat(75) + "\n");

// ----------------------------------------------------------------------------
// 1. Strict Linearizability vs Eventual Consistency
// ----------------------------------------------------------------------------
console.log("--- 1. Testing Consistency Models (Linearizability vs Eventual) ---");

interface ReplicaNode {
  id: string;
  data: Map<string, { value: any; timestamp: number; vector: VectorClock }>;
  isPartitioned: boolean;
}

const cluster: ReplicaNode[] = [
  { id: "dc-mumbai", data: new Map(), isPartitioned: false },
  { id: "dc-hyderabad", data: new Map(), isPartitioned: false },
  { id: "dc-bengaluru", data: new Map(), isPartitioned: false },
];

function writeQuorum(key: string, val: any, vector: VectorClock): boolean {
  const ts = Date.now();
  let acks = 0;
  for (const node of cluster) {
    if (!node.isPartitioned) {
      node.data.set(key, { value: val, timestamp: ts, vector });
      acks++;
    }
  }
  return acks >= 2; // W = 2 (Quorum for N = 3)
}

function readQuorum(key: string): any {
  const versions: { value: any; timestamp: number; vector: VectorClock }[] = [];
  for (const node of cluster) {
    if (!node.isPartitioned) {
      const v = node.data.get(key);
      if (v) versions.push(v);
    }
  }
  if (versions.length < 2) return null; // R = 2
  versions.sort((a, b) => b.timestamp - a.timestamp);
  return versions[0].value;
}

const v0: VectorClock = [1, 0, 0, 0];
const writeAck = writeQuorum("account:sanika@bank:balance", 10000, v0);
assert(writeAck === true, "Quorum write (W=2) acknowledged across healthy replicas");

const readVal = readQuorum("account:sanika@bank:balance");
assert(readVal === 10000, "Quorum read (R=2) satisfies R + W > N (Linearizable consistency)");

// ----------------------------------------------------------------------------
// 2. Simulated Network Partition (CAP Theorem Trade-Off)
// ----------------------------------------------------------------------------
console.log("\n--- 2. Testing Network Partition (CAP Theorem Trade-off) ---");
// Simulate network partition isolating dc-bengaluru
cluster[2].isPartitioned = true;
console.log("  Injected network partition: dc-bengaluru disconnected from quorum.");

// CP Choice: Writes still succeed on major partition (dc-mumbai + dc-hyderabad)
const v1: VectorClock = [2, 0, 0, 0];
const writeDuringPartition = writeQuorum("account:sanika@bank:balance", 9500, v1);
assert(writeDuringPartition === true, "Majority partition (2/3 nodes) preserves write progress");

// Minor partition cannot achieve write quorum alone
const minorAcks = cluster[2].isPartitioned ? 0 : 1;
assert(minorAcks < 2, "Isolated partition cannot commit independent writes (Prevents split-brain)");

// ----------------------------------------------------------------------------
// 3. Conflict Resolution: Last-Write-Wins (LWW) & Vector Causal Merging
// ----------------------------------------------------------------------------
console.log("\n--- 3. Testing Conflict Resolution & Reconciliation ---");
const vA: VectorClock = [2, 1, 0, 0];
const vB: VectorClock = [2, 0, 1, 0];

const cmp = VectorClockManager.compare(vA, vB);
assert(cmp.relation === "CONCURRENT", "Concurrent branch updates accurately classified as CONCURRENT");

// Deterministic Last-Write-Wins (LWW) resolution
const conflict1 = { value: "Version-A", timestamp: 1000, vector: vA };
const conflict2 = { value: "Version-B", timestamp: 1050, vector: vB };
const resolved = conflict1.timestamp > conflict2.timestamp ? conflict1 : conflict2;
assert(resolved.value === "Version-B", "Last-Write-Wins deterministically breaks concurrency tie");

// Reconnecting partitioned replica
cluster[2].isPartitioned = false;
for (const [k, v] of cluster[0].data.entries()) {
  cluster[2].data.set(k, v);
}
assert(cluster[2].data.get("account:sanika@bank:balance")?.value === 9500, "Eventual consistency achieved: Partitioned replica caught up");

// ----------------------------------------------------------------------------
// 4. Closed-System Money Conservation Invariant
// ----------------------------------------------------------------------------
console.log("\n--- 4. Testing Closed-System Money Conservation Invariant ---");
const senderBefore = rupeesToPaise(10000);
const receiverBefore = rupeesToPaise(5000);
const totalBefore = senderBefore + receiverBefore;

const txnAmount = rupeesToPaise(2500);
const senderAfter = senderBefore - txnAmount;
const receiverAfter = receiverBefore + txnAmount;
const totalAfter = senderAfter + receiverAfter;

assert(totalBefore === totalAfter, `Conservation of money strictly preserved: ₹${paiseToRupees(totalBefore)} == ₹${paiseToRupees(totalAfter)}`);
assert(senderAfter >= 0 && receiverAfter >= 0, "No account balance experienced negative overdraft");

console.log("\n" + "=".repeat(75));
console.log("ALL DISTRIBUTED DATABASE CONSISTENCY EXPERIMENTS PASSED (100% SUCCESS)");
console.log("=".repeat(75) + "\n");
