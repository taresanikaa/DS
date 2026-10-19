// ============================================================================
// UNIT II: Distributed Systems Communication & Fault Tolerance Engine
// Topics:
// 1. Remote Procedure Call (RPC vs gRPC vs REST)
// 2. Message-Oriented Communication (In-Process AMQP Queue Broker)
// 3. Stream-Oriented Communication (Sequence Numbering & Replay Buffer)
// 4. P2P Messaging (Direct Inter-Bank Mesh)
// 5. WebRTC (Signaling, SCTP DataChannel & STUN/TURN Topology)
// 6. WebSocket (Real-Time Push & Authoritative Reconciliation)
// 7. Names, Identifiers, and Addresses (DNS, VPA & K8s Service Discovery)
// 8. Fault Tolerance (3-State Circuit Breakers, Retries, & Reconciliations)
// ============================================================================

import { randomUUID } from "node:crypto";
import { persistentDb } from "./db.js";

// ----------------------------------------------------------------------------
// 1. Remote Procedure Call (General RPC vs Concrete gRPC Framework)
// ----------------------------------------------------------------------------

export interface RpcInvocationRequest {
  requestId: string;
  callingService: string;
  receivingService: string;
  procedureName: string;
  payload: Record<string, any>;
  timeoutMs: number;
  protocol: "GENERIC_RPC" | "GRPC_HTTP2" | "REST_HTTP1";
}

export interface RpcInvocationResponse {
  requestId: string;
  correlationId: string;
  callingService: string;
  receivingService: string;
  procedureName: string;
  protocol: string;
  executionOutcome: "SUCCESS" | "DEADLINE_EXCEEDED" | "SERVICE_UNAVAILABLE" | "INVALID_ARGUMENT";
  latencyMs: number;
  requestPayload: Record<string, any>;
  responsePayload: Record<string, any>;
  errorMessage?: string;
  grpcStatus?: {
    code: number;
    name: string;
    description: string;
  };
  theoreticalDistinction: string;
}

export class RpcComparisonManager {
  executeCall(req: RpcInvocationRequest): RpcInvocationResponse {
    const startTime = Date.now();
    const correlationId = `CORR-${randomUUID().slice(0, 8)}`;

    // Simulate timeout handling if timeout is too short
    if (req.timeoutMs < 50) {
      return {
        requestId: req.requestId,
        correlationId,
        callingService: req.callingService,
        receivingService: req.receivingService,
        procedureName: req.procedureName,
        protocol: req.protocol,
        executionOutcome: "DEADLINE_EXCEEDED",
        latencyMs: req.timeoutMs,
        requestPayload: req.payload,
        responsePayload: {},
        errorMessage: `RPC Deadline Exceeded: Call timed out after ${req.timeoutMs}ms before receiving response`,
        grpcStatus: {
          code: 4,
          name: "DEADLINE_EXCEEDED",
          description: "The deadline expired before the operation could complete.",
        },
        theoreticalDistinction:
          "gRPC implements first-class context deadlines propagated across the entire call tree; generic RPC often relies on arbitrary client socket timeouts.",
      };
    }

    // Check payload validation
    if (!req.payload || typeof req.payload.amount !== "number" || req.payload.amount <= 0) {
      return {
        requestId: req.requestId,
        correlationId,
        callingService: req.callingService,
        receivingService: req.receivingService,
        procedureName: req.procedureName,
        protocol: req.protocol,
        executionOutcome: "INVALID_ARGUMENT",
        latencyMs: 8,
        requestPayload: req.payload,
        responsePayload: {},
        errorMessage: "RPC Client Error: Missing or negative amount in procedure parameters",
        grpcStatus: {
          code: 3,
          name: "INVALID_ARGUMENT",
          description: "Client specified an invalid argument.",
        },
        theoreticalDistinction:
          "In gRPC, strongly typed Protocol Buffers validate types at compile time and fail fast on schema mismatch; REST typically performs dynamic runtime parsing of JSON strings.",
      };
    }

    const latencyMs = req.protocol === "GRPC_HTTP2" ? 6 : req.protocol === "GENERIC_RPC" ? 14 : 28;

    let distinction = "";
    if (req.protocol === "GRPC_HTTP2") {
      distinction =
        "gRPC is a concrete RPC framework utilizing HTTP/2 transport, binary Protocol Buffers serialization, multiplexed bidirectional streaming, and standardized status codes. It is strictly not identical to HTTP REST.";
    } else if (req.protocol === "GENERIC_RPC") {
      distinction =
        "General RPC is an abstract distributed systems paradigm that allows a program to execute a subroutine on another address space without explicitly coding the network interaction details.";
    } else {
      distinction =
        "REST is an architectural style based on URI resources, standard HTTP verbs (GET, POST), textual JSON representation, and stateless interactions, incurring higher serialization and header overhead.";
    }

    return {
      requestId: req.requestId,
      correlationId,
      callingService: req.callingService,
      receivingService: req.receivingService,
      procedureName: req.procedureName,
      protocol: req.protocol,
      executionOutcome: "SUCCESS",
      latencyMs,
      requestPayload: req.payload,
      responsePayload: {
        status: "APPROVED",
        authCode: `AUTH-RPC-${randomUUID().slice(0, 6)}`,
        debitedAmount: req.payload.amount,
        account: req.payload.account || "sanika@bank",
        timestamp: new Date().toISOString(),
      },
      grpcStatus: {
        code: 0,
        name: "OK",
        description: "Operation completed successfully.",
      },
      theoreticalDistinction: distinction,
    };
  }
}

// ----------------------------------------------------------------------------
// 2. Message-Oriented Communication (In-Process AMQP Message Broker)
// ----------------------------------------------------------------------------

export interface MessageEnvelope<T = any> {
  messageId: string;
  correlationId: string;
  transactionId: string;
  routingKey: string;
  exchange: string;
  timestamp: string;
  attempt: number;
  idempotencyKey: string;
  payload: T;
  deliveryStatus: "QUEUED" | "DELIVERED" | "ACKNOWLEDGED" | "DUPLICATE_SKIPPED" | "DEAD_LETTERED";
  processedAt?: string;
  error?: string;
}

export interface ConsumerReceipt {
  messageId: string;
  correlationId: string;
  transactionId: string;
  consumerId: string;
  status: "PROCESSED_SUCCESSFULLY" | "DUPLICATE_DETECTED_NO_STATE_CHANGE" | "ERROR_DEAD_LETTERED";
  stateChangeApplied: boolean;
  financialEffect: string;
  originalProcessedAt?: string;
}

export class MessageOrientedQueueBroker {
  // Explicitly documented: In-process in-memory queue implementing AMQP semantics
  public readonly brokerType = "IN_PROCESS_IN_MEMORY_AMQP_EMULATOR";
  public readonly durableDistributedBroker = false;
  public readonly limitationNotice =
    "LIMITATION: This is an explicit in-process in-memory message queue. It provides AMQP 0-9-1 topic exchange, queue bindings, and idempotent consumer deduplication, but does NOT persist messages to disk across process restarts (unlike a physical distributed cluster of RabbitMQ or Apache Kafka nodes).";

  private queues = new Map<string, MessageEnvelope[]>();
  private deadLetterQueue: MessageEnvelope[] = [];
  private processedIdempotencyKeys = new Map<string, { processedAt: string; result: any }>();
  private publishedHistory: MessageEnvelope[] = [];

  constructor() {
    this.queues.set("q.sender.debit", []);
    this.queues.set("q.receiver.credit", []);
    this.queues.set("q.settlement.audit", []);
  }

  getQueues() {
    const status: Record<string, { queueDepth: number; headMessageId: string | null }> = {};
    for (const [name, msgs] of this.queues.entries()) {
      status[name] = {
        queueDepth: msgs.length,
        headMessageId: msgs.length > 0 ? msgs[0].messageId : null,
      };
    }
    return {
      brokerType: this.brokerType,
      queues: status,
      deadLetterQueueDepth: this.deadLetterQueue.length,
      processedCacheSize: this.processedIdempotencyKeys.size,
      limitationNotice: this.limitationNotice,
    };
  }

  publishMessage<T>(
    exchange: string,
    routingKey: string,
    transactionId: string,
    idempotencyKey: string,
    payload: T
  ): MessageEnvelope<T> {
    const envelope: MessageEnvelope<T> = {
      messageId: `MSG-${randomUUID().slice(0, 8)}`,
      correlationId: `CORR-${transactionId}`,
      transactionId,
      routingKey,
      exchange,
      timestamp: new Date().toISOString(),
      attempt: 1,
      idempotencyKey,
      payload,
      deliveryStatus: "QUEUED",
    };

    // Route to queue based on routing key (AMQP Topic Exchange binding)
    let targetQueue = "q.sender.debit";
    if (routingKey.includes("credit")) {
      targetQueue = "q.receiver.credit";
    } else if (routingKey.includes("audit") || routingKey.includes("settle")) {
      targetQueue = "q.settlement.audit";
    }

    const q = this.queues.get(targetQueue) || [];
    q.push(envelope);
    this.queues.set(targetQueue, q);
    this.publishedHistory.push(envelope);

    return envelope;
  }

  consumeMessage(queueName: string, consumerId = "worker-debit-01"): ConsumerReceipt | null {
    const q = this.queues.get(queueName);
    if (!q || q.length === 0) return null;

    const envelope = q.shift()!;
    envelope.deliveryStatus = "DELIVERED";

    // Scenario: Consumer receives same event twice. Application MUST NOT perform the same financial state change twice.
    if (this.processedIdempotencyKeys.has(envelope.idempotencyKey)) {
      const existing = this.processedIdempotencyKeys.get(envelope.idempotencyKey)!;
      envelope.deliveryStatus = "DUPLICATE_SKIPPED";
      return {
        messageId: envelope.messageId,
        correlationId: envelope.correlationId,
        transactionId: envelope.transactionId,
        consumerId,
        status: "DUPLICATE_DETECTED_NO_STATE_CHANGE",
        stateChangeApplied: false,
        financialEffect: "NO_OP: Duplicate event rejected by consumer filter; balance not deducted again.",
        originalProcessedAt: existing.processedAt,
      };
    }

    // First-time processing: apply state change and record in idempotency store
    const now = new Date().toISOString();
    const resultRecord = {
      status: "DEBIT_SETTLED",
      amount: (envelope.payload as any)?.amount || 0,
      processedBy: consumerId,
    };

    this.processedIdempotencyKeys.set(envelope.idempotencyKey, {
      processedAt: now,
      result: resultRecord,
    });
    try {
      persistentDb.recordIdempotency(
        envelope.idempotencyKey,
        envelope.transactionId,
        "SETTLED",
        JSON.stringify(resultRecord)
      );
    } catch {}

    envelope.deliveryStatus = "ACKNOWLEDGED";
    envelope.processedAt = now;

    return {
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      transactionId: envelope.transactionId,
      consumerId,
      status: "PROCESSED_SUCCESSFULLY",
      stateChangeApplied: true,
      financialEffect: `STATE_CHANGE_COMMITTED: Financial debit of ₹${(envelope.payload as any)?.amount || 0} successfully applied.`,
      originalProcessedAt: now,
    };
  }

  simulateDuplicateDelivery(envelope: MessageEnvelope): ConsumerReceipt {
    // Retransmit same envelope to test consumer duplicate rejection
    return this.consumeSimulatedEnvelope(envelope, "worker-debit-01");
  }

  private consumeSimulatedEnvelope(envelope: MessageEnvelope, consumerId: string): ConsumerReceipt {
    const existingDbRecord = persistentDb.getIdempotency(envelope.idempotencyKey);
    if (this.processedIdempotencyKeys.has(envelope.idempotencyKey) || existingDbRecord) {
      const existing = this.processedIdempotencyKeys.get(envelope.idempotencyKey) || {
        processedAt: new Date().toISOString(),
        result: { status: existingDbRecord?.status || "COMMITTED" },
      };
      return {
        messageId: envelope.messageId,
        correlationId: envelope.correlationId,
        transactionId: envelope.transactionId,
        consumerId,
        status: "DUPLICATE_DETECTED_NO_STATE_CHANGE",
        stateChangeApplied: false,
        financialEffect: "NO_OP: Duplicate event rejected by consumer filter; balance not deducted again.",
        originalProcessedAt: existing.processedAt,
      };
    }

    const now = new Date().toISOString();
    this.processedIdempotencyKeys.set(envelope.idempotencyKey, {
      processedAt: now,
      result: { status: "COMMITTED" },
    });
    try {
      persistentDb.recordIdempotency(
        envelope.idempotencyKey,
        envelope.transactionId,
        "SETTLED",
        JSON.stringify({ status: "COMMITTED" })
      );
    } catch {}

    return {
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      transactionId: envelope.transactionId,
      consumerId,
      status: "PROCESSED_SUCCESSFULLY",
      stateChangeApplied: true,
      financialEffect: "STATE_CHANGE_COMMITTED: First-time processing applied.",
      originalProcessedAt: now,
    };
  }

  reset() {
    for (const q of this.queues.values()) {
      q.length = 0;
    }
    this.deadLetterQueue.length = 0;
    this.processedIdempotencyKeys.clear();
    this.publishedHistory.length = 0;
  }
}

// ----------------------------------------------------------------------------
// 7. Names, Identifiers, and Addresses (DNS, VPA & K8s Service Discovery)
// ----------------------------------------------------------------------------

export interface ServiceDescriptor {
  name: string; // Human-readable label (e.g. "NPCI Central Routing Switch")
  identifier: string; // Unique, immutable system ID (e.g. "node-npci-switch-01")
  address: string; // Resolvable network endpoint (e.g. "http://127.0.0.1:8002")
  k8sDnsName: string; // Kubernetes in-cluster DNS (e.g. "npci-service.default.svc.cluster.local:8002")
  protocol: string;
  health: "HEALTHY" | "DEGRADED" | "UNREACHABLE";
}

export class NameIdentifierAddressRegistry {
  private services = new Map<string, ServiceDescriptor>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults() {
    this.services.set("sender-bank", {
      name: "Sender Bank Core Banking System (Remitter CBS)",
      identifier: "cbs-sender-bank-hdfc-01",
      address: "http://127.0.0.1:8001",
      k8sDnsName: "sender-bank-service.banking.svc.cluster.local:8001",
      protocol: "REST & gRPC (HTTP/2)",
      health: "HEALTHY",
    });

    this.services.set("npci", {
      name: "NPCI Central Switch & Routing Hub",
      identifier: "switch-npci-clearing-01",
      address: "http://127.0.0.1:8002",
      k8sDnsName: "npci-switch-service.clearing.svc.cluster.local:8002",
      protocol: "Internal RPC / TCP",
      health: "HEALTHY",
    });

    this.services.set("receiver-bank", {
      name: "Receiver Bank Core Banking System (Beneficiary CBS)",
      identifier: "cbs-receiver-bank-icici-02",
      address: "http://127.0.0.1:8003",
      k8sDnsName: "receiver-bank-service.banking.svc.cluster.local:8003",
      protocol: "REST & gRPC (HTTP/2)",
      health: "HEALTHY",
    });

    this.services.set("transaction-service", {
      name: "UPI Distributed Transaction Orchestrator",
      identifier: "orch-txn-coordinator-master",
      address: "http://127.0.0.1:3000",
      k8sDnsName: "txn-coordinator-service.default.svc.cluster.local:3000",
      protocol: "HTTP/1.1 REST & WSS",
      health: "HEALTHY",
    });

    this.services.set("grpc-account-service", {
      name: "gRPC High-Performance Account Microservice",
      identifier: "grpc-account-server-01",
      address: "grpc://127.0.0.1:50051",
      k8sDnsName: "grpc-account-service.banking.svc.cluster.local:50051",
      protocol: "gRPC over HTTP/2 Protobuf",
      health: "HEALTHY",
    });
  }

  resolveService(lookupKey: string): {
    found: boolean;
    descriptor?: ServiceDescriptor;
    resolutionPath?: string;
    k8sDnsExplanation: string;
  } {
    // Normalization: Can look up by short key, identifier, or DNS prefix
    for (const [key, desc] of this.services.entries()) {
      if (
        key === lookupKey ||
        desc.identifier === lookupKey ||
        desc.name.toLowerCase().includes(lookupKey.toLowerCase()) ||
        desc.k8sDnsName.startsWith(lookupKey)
      ) {
        return {
          found: true,
          descriptor: desc,
          resolutionPath: `Resolved Name '${desc.name}' -> Stable Identifier '${desc.identifier}' -> Network Address '${desc.address}'`,
          k8sDnsExplanation: `In Kubernetes clusters, kube-dns / CoreDNS resolves '${desc.k8sDnsName}' into the cluster IP of the Service without hardcoded IP dependencies.`,
        };
      }
    }

    return {
      found: false,
      k8sDnsExplanation: `Service discovery failed: Key '${lookupKey}' is unknown to the registry. CoreDNS would return NXDOMAIN.`,
    };
  }

  getAllServices(): ServiceDescriptor[] {
    return Array.from(this.services.values());
  }

  updateAddress(key: string, newAddress: string) {
    const desc = this.services.get(key);
    if (desc) {
      desc.address = newAddress;
      return desc;
    }
    return null;
  }
}

// ----------------------------------------------------------------------------
// 8. Fault Tolerance & Reconciliation Manager
// ----------------------------------------------------------------------------

export type TransactionLifecycleState =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "UNKNOWN_OR_REQUIRES_RECONCILIATION";

export interface FaultToleranceAuditRecord {
  transactionId: string;
  senderId: string;
  amount: number;
  state: TransactionLifecycleState;
  retriesAttempted: number;
  maxRetriesAllowed: number;
  timeoutOccurred: boolean;
  senderDebited: boolean;
  receiverCredited: boolean;
  reconciliationRequired: boolean;
  reconciliationAction?: string;
  lastUpdated: string;
}

export class FaultToleranceManager {
  private auditRecords = new Map<string, FaultToleranceAuditRecord>();

  recordTransactionAttempt(
    transactionId: string,
    senderId: string,
    amount: number
  ): FaultToleranceAuditRecord {
    const record: FaultToleranceAuditRecord = {
      transactionId,
      senderId,
      amount,
      state: "PROCESSING",
      retriesAttempted: 0,
      maxRetriesAllowed: 3,
      timeoutOccurred: false,
      senderDebited: false,
      receiverCredited: false,
      reconciliationRequired: false,
      lastUpdated: new Date().toISOString(),
    };
    this.auditRecords.set(transactionId, record);
    return record;
  }

  handleTimeoutAfterDebit(transactionId: string): FaultToleranceAuditRecord {
    const record = this.auditRecords.get(transactionId) || {
      transactionId,
      senderId: "sanika@bank",
      amount: 500,
      state: "PROCESSING",
      retriesAttempted: 3,
      maxRetriesAllowed: 3,
      timeoutOccurred: true,
      senderDebited: true,
      receiverCredited: false,
      reconciliationRequired: true,
      lastUpdated: new Date().toISOString(),
    };

    // CRITICAL DISTRIBUTED SYSTEMS SAFETY RULE:
    // Never mark an uncertain transaction as FAILED if it may already have committed on the receiver!
    // Instead mark as UNKNOWN_OR_REQUIRES_RECONCILIATION
    record.timeoutOccurred = true;
    record.senderDebited = true;
    record.receiverCredited = false;
    record.state = "UNKNOWN_OR_REQUIRES_RECONCILIATION";
    record.reconciliationRequired = true;
    record.reconciliationAction =
      "SAFETY RULE ENFORCED: Since Sender was debited but downstream Receiver ACK timed out, transaction state is UNCERTAIN. It cannot be marked FAILED until End-of-Day (EOD) ledger reconciliation verifies receiver CBS status.";
    record.lastUpdated = new Date().toISOString();

    this.auditRecords.set(transactionId, record);
    return record;
  }

  reconcileTransaction(transactionId: string, confirmedAtReceiver: boolean): FaultToleranceAuditRecord {
    const record = this.auditRecords.get(transactionId);
    if (!record) {
      throw new Error(`Transaction ${transactionId} not found for reconciliation`);
    }

    if (confirmedAtReceiver) {
      record.receiverCredited = true;
      record.state = "COMPLETED";
      record.reconciliationRequired = false;
      record.reconciliationAction = "RECONCILED: Receiver CBS confirmed credit was settled. Transaction promoted to COMPLETED.";
    } else {
      record.senderDebited = false;
      record.state = "FAILED";
      record.reconciliationRequired = false;
      record.reconciliationAction = "RECONCILED: Receiver CBS confirmed zero credit. Compensating refund issued to sender; transaction marked FAILED.";
    }

    record.lastUpdated = new Date().toISOString();
    return record;
  }

  getRecord(transactionId: string): FaultToleranceAuditRecord | undefined {
    return this.auditRecords.get(transactionId);
  }
}
