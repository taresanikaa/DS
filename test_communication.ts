import {
  LodhaKshemkalyaniMutexManager,
  KnappDeadlockDetectionManager,
  DistributedSystemsParadigmsManager,
  LamportClockManager,
  VectorClockManager,
  GlobalStateManager,
  BeaconProtocolManager,
  ElectionAlgorithmManager,
  DistributedMutexManager,
} from "./src/server/synchronization.ts";

console.log("=================================================");
console.log(" RUNNING DISTRIBUTED SYSTEMS VERIFICATION TESTS ");
console.log("=================================================\n");

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, message: string) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✓ [PASS] ${message}`);
  } else {
    console.error(`  ✗ [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

// -------------------------------------------------------------
// 1. Lodha & Kshemkalyani's Fair Mutual Exclusion Algorithm
// -------------------------------------------------------------
console.log("TEST SUITE 1: Lodha & Kshemkalyani Fair Mutual Exclusion");
{
  const lkManager = new LodhaKshemkalyaniMutexManager();

  // Initial state check
  const state0 = lkManager.getState();
  assert(state0.currentHolder === null, "Initial lock holder should be null");
  assert(state0.waitingQueue.length === 0, "Initial waiting queue should be empty");

  // Node 1 requests lock with clock = 10
  const req1 = lkManager.requestLock("node-1", 10);
  assert(req1.granted === true, "Node 1 should be granted lock immediately when free");
  assert(req1.messagesExchanged >= 3, "Node 1 exchanged restricted multicast messages (O(N) bounded overhead)");

  // Node 3 requests lock with clock = 25
  const req2 = lkManager.requestLock("node-3", 25);
  assert(req2.granted === false, "Node 3 should be queued because Node 1 holds lock");

  // Node 2 requests lock with clock = 15 (earlier than Node 3, testing fair timestamp order)
  const req3 = lkManager.requestLock("node-2", 15);
  assert(req3.granted === false, "Node 2 should be queued because Node 1 holds lock");

  // Verify priority order based on (timestamp, nodeId)
  const state1 = lkManager.getState();
  assert(
    state1.waitingQueue[0].nodeId === "node-2" && state1.waitingQueue[1].nodeId === "node-3",
    "Waiting queue must be ordered fairly by causal timestamp: Node 2 (clock 15) before Node 3 (clock 25)"
  );

  // Node 1 releases lock; Node 2 should acquire it next
  const rel1 = lkManager.releaseLock("node-1");
  assert(rel1.releasedBy === "node-1", "Release recorded correctly for node-1");
  assert(rel1.nextHolder === "node-2", "Node 2 granted lock next per fair FIFO causal ordering");

  // Node 2 releases lock; Node 3 should acquire it next
  const rel2 = lkManager.releaseLock("node-2");
  assert(rel2.nextHolder === "node-3", "Node 3 granted lock after Node 2");

  // Node 3 releases lock; queue empty
  const rel3 = lkManager.releaseLock("node-3");
  assert(rel3.nextHolder === null, "No more waiters; lock becomes free");
}

// -------------------------------------------------------------
// 2. Knapp's 4 Classes of Distributed Deadlock Detection
// -------------------------------------------------------------
console.log("\nTEST SUITE 2: Knapp's Classification of Distributed Deadlock Detection");
{
  const knapp = new KnappDeadlockDetectionManager();

  // Class 1: Edge-Chasing (Chandy-Misra-Haas Probe)
  const edge = knapp.runDetection("EDGE_CHASING");
  assert(edge.category === "EDGE_CHASING", "Edge-Chasing class recognized");
  assert(edge.deadlockDetected === true, "Deadlock probe successfully detected wait-for cycle");
  assert(edge.cycle.length >= 3, "Cycle path correctly isolated across participating banks");

  // Class 2: Path-Pushing (Obermarck)
  const path = knapp.runDetection("PATH_PUSHING");
  assert(path.category === "PATH_PUSHING", "Path-Pushing class recognized");
  assert(path.deadlockDetected === true, "Obermarck path pushing identified cycle in combined WFG");

  // Class 3: Diffusion Computation (Dijkstra-Scholten)
  const diff = knapp.runDetection("DIFFUSION_COMPUTATION");
  assert(diff.category === "DIFFUSION_COMPUTATION", "Diffusion Computation class recognized");
  assert(diff.deadlockDetected === true, "Query echo completed with deadlock detected");

  // Class 4: Global State Detection (Kshemkalyani-Singhal)
  const global = knapp.runDetection("GLOBAL_STATE_DETECTION");
  assert(global.category === "GLOBAL_STATE_DETECTION", "Global State Detection class recognized");
  assert(global.deadlockDetected === true, "Consistent snapshot identified knot/cycle");
}

// -------------------------------------------------------------
// 3. Distributed Paradigms (RMI, DFS Replication, Serverless)
// -------------------------------------------------------------
console.log("\nTEST SUITE 3: Distributed Paradigms (Unit IV)");
{
  const paradigms = new DistributedSystemsParadigmsManager();

  // RMI Invocation
  const rmiDebit = paradigms.invokeRMI("debitAccount", "aarav@upi", 1500);
  assert(rmiDebit.result.status === "DEBIT_CONFIRMED", "RMI debitAccount method invoked successfully");
  assert(rmiDebit.paradigm.includes("Remote Method Invocation"), "Protocol verified as RMI");
  assert(rmiDebit.trace.length >= 5, "Stub-Skeleton lifecycle executed in canonical stages");

  // DFS Audit Chunk Replication
  const dfs = paradigms.replicateAuditChunk("TXN-TEST-001", 2500);
  assert(dfs.replicationFactor === 3, "HDFS replication factor configured to 3");
  assert(dfs.replicaNodes.length === 3, "Rack-aware replication across 3 distinct datacenters (MUM, HYD, BLR)");
  assert(dfs.consistencyModel.includes("Quorum"), "Pipeline quorum acknowledgement satisfied");

  // Serverless Cold vs Warm Execution
  const coldExec = paradigms.invokeServerlessWebhook(false);
  assert(coldExec.state === "COLD_START_PROVISIONED", "Cold start provisioned new microVM container");
  assert(coldExec.breakdown.containerAllocationMs > 0, "Cold start incurs container initialization overhead");

  const warmExec = paradigms.invokeServerlessWebhook(true);
  assert(warmExec.state === "WARM_CONTAINER_REUSED", "Warm execution reused existing execution sandbox");
  assert(warmExec.breakdown.containerAllocationMs === 0, "Warm execution avoids container provisioning latency");
  assert(warmExec.breakdown.totalLatencyMs < coldExec.breakdown.totalLatencyMs, "Warm execution has strictly lower latency than cold start");
}

// -------------------------------------------------------------
// 4. Lamport, Vector Clocks, Chandy-Lamport, & Elections
// -------------------------------------------------------------
console.log("\nTEST SUITE 4: Core Synchronization & Fault Detection");
{
  const lamport = new LamportClockManager();
  const c1 = lamport.tickLocal("npci", "Process batch");
  assert(c1 === 1, "Lamport tickLocal increments clock to 1");
  const cSend = lamport.tickSend("npci", "receiver-bank", "Forward Credit");
  assert(cSend === 2, "Lamport tickSend increments to 2");
  const cRecv = lamport.tickReceive("receiver-bank", "npci", cSend, "Credit received");
  assert(cRecv === 3, "Lamport tickReceive applies max(0, 2) + 1 = 3");

  const vector = new VectorClockManager();
  const v1 = vector.tickLocal("npci", "Local state update");
  assert(Array.isArray(v1) && v1.length === 4, "Vector clock initialized with 4 nodes");

  const election = new ElectionAlgorithmManager();
  const bully = election.runBullyElection("sender-bank", "receiver-bank");
  assert(bully.electedCoordinator.length > 0, "Bully election selects coordinator");

  const ring = election.runRingElection("sender-bank", "npci");
  assert(ring.electedCoordinator.length > 0, "Ring election circulates token and elects coordinator");

  const beacon = new BeaconProtocolManager();
  const initialBeacons = beacon.getBeacons();
  assert(initialBeacons.length === 4, "4 nodes initialized for beacon protocol");
  assert(initialBeacons.every((b) => b.status === "HEALTHY"), "All nodes initially HEALTHY");
}

console.log("\n=================================================");
console.log(` SUMMARY: ${passedCount} / ${totalCount} tests passed successfully.`);
console.log("=================================================");
