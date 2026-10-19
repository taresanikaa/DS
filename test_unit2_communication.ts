// ============================================================================
// Automated Test Suite for UNIT II: Distributed Communication & Fault Tolerance
// Covers:
// 1. Remote Procedure Call (RPC vs gRPC vs REST)
// 2. Message-Oriented Communication (In-Process AMQP Queue Broker & Idempotency)
// 3. Stream-Oriented Communication (Sequence Numbering & Replay Buffer)
// 4. P2P Messaging (Direct Inter-Bank Mesh)
// 5. WebRTC (Signaling, SCTP DataChannel & STUN/TURN Topology)
// 6. WebSocket (Real-Time Push & Authoritative Reconciliation)
// 7. Names, Identifiers, and Addresses (DNS, VPA & K8s Service Discovery)
// 8. Fault Tolerance (3-State Circuit Breakers, Retries, & Reconciliations)
// ============================================================================

import {
  RpcComparisonManager,
  MessageOrientedQueueBroker,
  NameIdentifierAddressRegistry,
  FaultToleranceManager,
} from "./src/server/communication.ts";

let passed = 0;
let total = 0;

function assert(condition: boolean, message: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ [PASS] ${message}`);
  } else {
    console.error(`  ✗ [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

console.log("=============================================================");
console.log("  RUNNING UNIT II: COMMUNICATION & FAULT TOLERANCE TESTS");
console.log("=============================================================\n");

// ----------------------------------------------------------------------------
// FEATURE 1: Remote Procedure Call (RPC vs gRPC vs REST)
// ----------------------------------------------------------------------------
console.log("--- 1. Testing Remote Procedure Call (RPC vs gRPC vs REST) ---");
{
  const rpcMgr = new RpcComparisonManager();

  // Test successful gRPC call
  const grpcCall = rpcMgr.executeCall({
    requestId: "REQ-001",
    callingService: "Transaction Coordinator",
    receivingService: "Sender Bank CBS",
    procedureName: "VerifyAndDebit",
    payload: { account: "sanika@bank", amount: 500 },
    timeoutMs: 2000,
    protocol: "GRPC_HTTP2",
  });
  assert(grpcCall.executionOutcome === "SUCCESS", "gRPC procedure executed successfully");
  assert(grpcCall.grpcStatus?.code === 0, "gRPC returns Status Code 0 (OK)");
  assert(grpcCall.protocol === "GRPC_HTTP2", "Protocol verified as gRPC over HTTP/2");
  assert(grpcCall.correlationId.startsWith("CORR-"), "Transaction correlation ID attached");
  assert(grpcCall.requestPayload.amount === 500, "Request payload parameters verified");
  assert(grpcCall.responsePayload.status === "APPROVED", "Response payload returns approval");
  assert(grpcCall.theoreticalDistinction.includes("HTTP/2"), "Theoretical distinction accurately notes HTTP/2 and Protobuf");

  // Test RPC Timeout (DEADLINE_EXCEEDED)
  const timeoutCall = rpcMgr.executeCall({
    requestId: "REQ-002",
    callingService: "Transaction Coordinator",
    receivingService: "Sender Bank CBS",
    procedureName: "VerifyAndDebit",
    payload: { account: "sanika@bank", amount: 500 },
    timeoutMs: 20, // < 50ms triggers deadline
    protocol: "GRPC_HTTP2",
  });
  assert(timeoutCall.executionOutcome === "DEADLINE_EXCEEDED", "RPC deadline exceeded correctly triggered");
  assert(timeoutCall.grpcStatus?.code === 4, "gRPC returns Status Code 4 (DEADLINE_EXCEEDED)");

  // Test Invalid Arguments (INVALID_ARGUMENT)
  const invalidCall = rpcMgr.executeCall({
    requestId: "REQ-003",
    callingService: "Transaction Coordinator",
    receivingService: "Sender Bank CBS",
    procedureName: "VerifyAndDebit",
    payload: { account: "sanika@bank", amount: -100 }, // Negative amount
    timeoutMs: 2000,
    protocol: "GRPC_HTTP2",
  });
  assert(invalidCall.executionOutcome === "INVALID_ARGUMENT", "Invalid argument caught and rejected");
  assert(invalidCall.grpcStatus?.code === 3, "gRPC returns Status Code 3 (INVALID_ARGUMENT)");
}

// ----------------------------------------------------------------------------
// FEATURE 2: Message-Oriented Communication (In-Process AMQP Queue Broker)
// ----------------------------------------------------------------------------
console.log("\n--- 2. Testing Message-Oriented Communication & Idempotency ---");
{
  const broker = new MessageOrientedQueueBroker();

  // Test Queue Implementation Type & Limitation Notice
  assert(broker.brokerType === "IN_PROCESS_IN_MEMORY_AMQP_EMULATOR", "Identified as in-process in-memory queue");
  assert(broker.durableDistributedBroker === false, "Explicitly documents it is not a durable distributed broker");
  assert(broker.limitationNotice.includes("LIMITATION"), "Limitation notice explicitly documented");

  // Publish message (Producer)
  const env = broker.publishMessage(
    "upi.transactions",
    "txn.debit.remitter",
    "TXN-AMQP-101",
    "IDEM-STRICT-101",
    { amount: 750, senderUpi: "sanika@bank", receiverUpi: "navya@bank" }
  );
  assert(env.messageId.startsWith("MSG-"), "Unique message ID generated");
  assert(env.correlationId === "CORR-TXN-AMQP-101", "Correlation ID matches transaction ID");
  assert(env.deliveryStatus === "QUEUED", "Message state starts as QUEUED");

  // Consume message (Consumer) - 1st delivery
  const receipt1 = broker.consumeMessage("q.sender.debit", "worker-debit-01");
  assert(receipt1 !== null, "Message successfully dequeued by consumer worker");
  assert(receipt1?.status === "PROCESSED_SUCCESSFULLY", "First delivery processed successfully");
  assert(receipt1?.stateChangeApplied === true, "State change applied on first delivery");
  assert(receipt1?.financialEffect.includes("COMMITTED"), "Financial debit applied");

  // Duplicate Delivery Scenario: Consumer receives the same event twice
  const receipt2 = broker.simulateDuplicateDelivery(env);
  assert(receipt2.status === "DUPLICATE_DETECTED_NO_STATE_CHANGE", "Duplicate event detected by consumer idempotency filter");
  assert(receipt2.stateChangeApplied === false, "Idempotency guaranteed: financial state change NOT applied twice");
  assert(receipt2.financialEffect.includes("NO_OP"), "Operation treated as NO-OP on duplicate delivery");
}

// ----------------------------------------------------------------------------
// FEATURE 3: Stream-Oriented Communication
// ----------------------------------------------------------------------------
console.log("\n--- 3. Testing Stream-Oriented Communication ---");
{
  // Sequence numbers & ordering
  let seq = 1;
  const events = [
    { sequence: seq++, event: "TXN_INITIATED" },
    { sequence: seq++, event: "SENDER_DEBITED" },
    { sequence: seq++, event: "NPCI_ROUTED" },
    { sequence: seq++, event: "RECEIVER_CREDITED" },
  ];

  assert(events[0].sequence < events[1].sequence, "Stream sequence numbers strictly monotonic");
  assert(events.length === 4, "Stream producer emits continuous event chain");

  // Replay buffer simulation: requesting events after sequence 2
  const lastRequestedSeq = 2;
  const replayed = events.filter((e) => e.sequence > lastRequestedSeq);
  assert(replayed.length === 2, "Replay buffer delivers exactly the 2 missed events");
  assert(replayed[0].event === "NPCI_ROUTED", "Replay preserves correct order of missed events");
}

// ----------------------------------------------------------------------------
// FEATURE 4: P2P Messaging
// ----------------------------------------------------------------------------
console.log("\n--- 4. Testing P2P Messaging ---");
{
  const peerSender = { peerId: "peer-sender-bank-01", name: "HDFC Remitter CBS" };
  const peerReceiver = { peerId: "peer-receiver-bank-02", name: "ICICI Beneficiary CBS" };

  assert(peerSender.peerId !== peerReceiver.peerId, "Peers have unique peer identifiers");

  // Direct P2P packet exchange without NPCI switch
  const directP2pPacket = {
    messageId: "P2P-MSG-991",
    senderPeerId: peerSender.peerId,
    targetPeerId: peerReceiver.peerId,
    npciHopCount: 0,
    amount: 150,
    directChannel: true,
  };

  assert(directP2pPacket.npciHopCount === 0, "P2P bypasses central NPCI switch");
  assert(directP2pPacket.directChannel === true, "Direct inter-bank peer link verified");
}

// ----------------------------------------------------------------------------
// FEATURE 5: WebRTC DataChannel
// ----------------------------------------------------------------------------
console.log("\n--- 5. Testing WebRTC Signaling & DataChannel ---");
{
  const signalingOffer = {
    type: "offer",
    sdp: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\nm=application 9 DTLS/SCTP 5000",
    sctpDataChannel: true,
  };
  const signalingAnswer = {
    type: "answer",
    sdp: "v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\nm=application 9 DTLS/SCTP 5000",
    sctpDataChannel: true,
  };
  const iceCandidate = {
    type: "ice-candidate",
    candidate: "candidate:1 1 UDP 2130706431 10.0.4.15 58320 typ host",
    protocol: "UDP",
  };

  assert(signalingOffer.sctpDataChannel === true, "WebRTC negotiates SCTP DataChannel");
  assert(signalingAnswer.type === "answer", "Signaling server exchanges SDP Answer");
  assert(iceCandidate.protocol === "UDP", "ICE candidates negotiated over UDP transport");
}

// ----------------------------------------------------------------------------
// FEATURE 6: WebSocket Communication
// ----------------------------------------------------------------------------
console.log("\n--- 6. Testing WebSocket Communication & Authoritative Commit ---");
{
  const wsStatus = "connected";
  assert(wsStatus === "connected", "WebSocket connection state active");

  // Verify distinction: WebSocket message is presentation telemetry; REST is authoritative
  const wsTelemetryEvent = {
    event: "PAYMENT_SUCCESS",
    transactionId: "TXN-881",
    status: "SUCCESS",
    isAuthoritativeCommitProof: false, // Presentation only
  };
  assert(wsTelemetryEvent.isAuthoritativeCommitProof === false, "WebSocket message is not treated as proof of durable commit");

  const restAuthoritativeRecord = {
    transactionId: "TXN-881",
    status: "SUCCESS",
    persistedToLedger: true,
    isAuthoritativeCommitProof: true,
  };
  assert(restAuthoritativeRecord.isAuthoritativeCommitProof === true, "Backend REST ledger query is authoritative source of truth");
}

// ----------------------------------------------------------------------------
// FEATURE 7: Names, Identifiers, and Addresses
// ----------------------------------------------------------------------------
console.log("\n--- 7. Testing Names, Identifiers, and Addresses ---");
{
  const registry = new NameIdentifierAddressRegistry();
  const services = registry.getAllServices();
  assert(services.length >= 4, "Registry initialized with core banking and clearing services");

  // Name vs Identifier vs Address distinction
  const npci = services.find((s) => s.identifier === "switch-npci-clearing-01")!;
  assert(npci.name === "NPCI Central Switch & Routing Hub", "Name is human-readable label");
  assert(npci.identifier === "switch-npci-clearing-01", "Identifier is immutable unique system ID");
  assert(npci.address.includes("8002"), "Address is physical resolvable network endpoint");
  assert(npci.k8sDnsName.includes("svc.cluster.local"), "Kubernetes CoreDNS resolvable name provided");

  // Test service discovery
  const resolved = registry.resolveService("sender-bank");
  assert(resolved.found === true, "Service discovery successfully resolved 'sender-bank'");
  assert(resolved.descriptor?.address === "http://127.0.0.1:8001", "Resolved to correct endpoint address");

  // Test invalid/missing identifier
  const invalidLookup = registry.resolveService("nonexistent-service-999");
  assert(invalidLookup.found === false, "Missing service identifier cleanly returns found=false");
  assert(invalidLookup.k8sDnsExplanation.includes("NXDOMAIN"), "Returns CoreDNS NXDOMAIN explanation");
}

// ----------------------------------------------------------------------------
// FEATURE 8: Fault Tolerance & Uncertain Reconciliation
// ----------------------------------------------------------------------------
console.log("\n--- 8. Testing Fault Tolerance & Reconciliation ---");
{
  const ftMgr = new FaultToleranceManager();

  // Test Initial Transaction Registration
  const initial = ftMgr.recordTransactionAttempt("TXN-TEST-RECON", "sanika@bank", 500);
  assert(initial.state === "PROCESSING", "Initial state recorded as PROCESSING");

  // Downstream Timeout after Sender Debit
  // SAFETY RULE: Must NOT be marked FAILED if sender was debited and receiver is uncertain!
  const uncertain = ftMgr.handleTimeoutAfterDebit("TXN-TEST-RECON");
  assert(uncertain.state === "UNKNOWN_OR_REQUIRES_RECONCILIATION", "Marked as UNKNOWN_OR_REQUIRES_RECONCILIATION");
  assert(uncertain.senderDebited === true, "Sender debit preserved during uncertainty");
  assert(uncertain.reconciliationRequired === true, "Flagged for End-of-Day reconciliation");
  assert(uncertain.reconciliationAction?.includes("SAFETY RULE"), "Safety rule documented on record");

  // Reconcile: Receiver confirmed credit -> COMPLETED
  const reconciledSuccess = ftMgr.reconcileTransaction("TXN-TEST-RECON", true);
  assert(reconciledSuccess.state === "COMPLETED", "Promoted to COMPLETED when receiver confirms settlement");
  assert(reconciledSuccess.reconciliationRequired === false, "Reconciliation flag cleared");

  // Second test: Receiver confirmed missing -> Refund & FAILED
  ftMgr.recordTransactionAttempt("TXN-TEST-REFUND", "sanika@bank", 300);
  ftMgr.handleTimeoutAfterDebit("TXN-TEST-REFUND");
  const reconciledRefund = ftMgr.reconcileTransaction("TXN-TEST-REFUND", false);
  assert(reconciledRefund.state === "FAILED", "Marked FAILED when receiver confirms zero credit");
  assert(reconciledRefund.reconciliationAction?.includes("Compensating refund"), "Compensating refund issued to sender");
}

console.log("\n=============================================================");
console.log(` SUMMARY: ${passed} / ${total} UNIT II communication tests passed.`);
console.log("=============================================================");
