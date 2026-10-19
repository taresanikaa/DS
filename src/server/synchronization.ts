// ============================================================================
// UNIT III: Distributed Synchronization & Fair Mutual Exclusion
// Retained Features:
// 1. Lamport's Logical Clocks (Leslie Lamport 1978)
// 2. Service-Level HTTP Request Interceptor (x-lamport-clock headers)
// 3. Distributed Mutual Exclusion (Ricart-Agrawala & Token-Ring)
// 4. Lodha & Kshemkalyani's Fair Mutual Exclusion Algorithm (1998)
// ============================================================================

export interface LamportNodeState {
  id: string;
  name: string;
  clock: number;
  lastEvent: string;
  lastTimestamp: string;
}

// ----------------------------------------------------------------------------
// 1. Lamport's Logical Clock Algorithm
// Rules:
// - Rule 1 (Local event): L_i = L_i + 1
// - Rule 2 (Send event): L_i = L_i + 1, attach L_msg = L_i to message
// - Rule 3 (Receive event): L_j = max(L_j, L_msg) + 1
// ----------------------------------------------------------------------------

export class LamportClockManager {
  private clocks: Map<string, number> = new Map();
  private eventHistory: Array<{
    id: string;
    nodeId: string;
    eventType: "LOCAL" | "SEND" | "RECEIVE";
    clockBefore: number;
    clockAfter: number;
    description: string;
    timestamp: string;
    incomingTimestamp?: number;
  }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.clocks.set("sender-bank", 0);
    this.clocks.set("transaction-service", 0);
    this.clocks.set("npci", 0);
    this.clocks.set("receiver-bank", 0);
    this.eventHistory = [];
  }

  getClock(nodeId: string): number {
    return this.clocks.get(nodeId) || 0;
  }

  getAllClocks(): LamportNodeState[] {
    const names: Record<string, string> = {
      "sender-bank": "Sender Bank Service",
      "transaction-service": "Transaction Service",
      "npci": "NPCI Simulator",
      "receiver-bank": "Receiver Bank Service",
    };
    return Array.from(this.clocks.entries()).map(([id, clock]) => {
      const last = this.eventHistory.filter((e) => e.nodeId === id).slice(-1)[0];
      return {
        id,
        name: names[id] || id,
        clock,
        lastEvent: last?.description || "Initialized (L=0)",
        lastTimestamp: last?.timestamp || new Date().toISOString(),
      };
    });
  }

  getHistory(limit = 50) {
    return [...this.eventHistory].reverse().slice(0, limit);
  }

  /**
   * Rule 1 (Local event): L_i = L_i + 1
   */
  tickLocal(nodeId: string, description: string): number {
    const current = this.getClock(nodeId);
    const updated = current + 1;
    this.clocks.set(nodeId, updated);

    this.eventHistory.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      nodeId,
      eventType: "LOCAL",
      clockBefore: current,
      clockAfter: updated,
      description,
      timestamp: new Date().toISOString(),
    });

    return updated;
  }

  /**
   * Rule 2 (Send event): L_i = L_i + 1, attach L_msg = L_i to outgoing message
   */
  tickSend(nodeId: string, targetNodeOrDesc: string, maybeDesc?: string): number {
    const description = maybeDesc !== undefined ? `${maybeDesc} (to ${targetNodeOrDesc})` : targetNodeOrDesc;
    const current = this.getClock(nodeId);
    const updated = current + 1;
    this.clocks.set(nodeId, updated);

    this.eventHistory.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      nodeId,
      eventType: "SEND",
      clockBefore: current,
      clockAfter: updated,
      description,
      timestamp: new Date().toISOString(),
    });

    return updated;
  }

  /**
   * Rule 3 (Receive event): L_j = max(L_j, L_msg) + 1
   */
  tickReceive(
    nodeId: string,
    fromNodeOrIncoming: string | number,
    incomingOrDesc?: number | string,
    maybeDesc?: string
  ): number {
    let incomingLamport: number;
    let description: string;

    if (typeof fromNodeOrIncoming === "number") {
      incomingLamport = fromNodeOrIncoming;
      description = String(incomingOrDesc || "Receive Event");
    } else {
      incomingLamport = Number(incomingOrDesc) || 0;
      description = maybeDesc !== undefined ? `${maybeDesc} (from ${fromNodeOrIncoming})` : String(incomingOrDesc || "Receive Event");
    }

    const current = this.getClock(nodeId);
    const updated = Math.max(current, incomingLamport) + 1;
    this.clocks.set(nodeId, updated);

    this.eventHistory.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      nodeId,
      eventType: "RECEIVE",
      clockBefore: current,
      clockAfter: updated,
      description,
      timestamp: new Date().toISOString(),
      incomingTimestamp: incomingLamport,
    });

    return updated;
  }
}

// ----------------------------------------------------------------------------
// 2. Service-Level HTTP Request Interceptor (Lamport Headers)
// ----------------------------------------------------------------------------

export interface InterceptorAuditEntry {
  id: string;
  sequence: number;
  transactionId: string;
  sourceService: string;
  targetService: string;
  endpoint: string;
  action: string;
  direction: "OUTGOING_REQUEST" | "INCOMING_REQUEST" | "OUTGOING_RESPONSE" | "INCOMING_RESPONSE";
  lamportTimestamp: number;
  clockBefore: number;
  clockAfter: number;
  headers: Record<string, string>;
  timestamp: string;
  details?: string;
}

export interface InterServiceCallEnvelope<T = any> {
  sourceService: string;
  targetService: string;
  endpoint: string;
  action: string;
  transactionId: string;
  headers: Record<string, string>;
  payload: T;
  lamportTimestamp: number;
}

export class ServiceLevelLamportInterceptor {
  private lamport: LamportClockManager;
  private auditLog: InterceptorAuditEntry[] = [];
  private sequenceCounter = 0;

  constructor(lamport: LamportClockManager) {
    this.lamport = lamport;
  }

  getAuditLog(limit = 60): InterceptorAuditEntry[] {
    return [...this.auditLog].reverse().slice(0, limit);
  }

  getMetrics() {
    const totalRequests = this.auditLog.filter((e) => e.direction === "OUTGOING_REQUEST").length;
    const totalResponses = this.auditLog.filter((e) => e.direction === "OUTGOING_RESPONSE").length;
    return {
      active: true,
      protocol: "Lamport's Logical Clock Interceptor (Leslie Lamport 1978)",
      totalInterceptedRequests: totalRequests,
      totalInterceptedResponses: totalResponses,
      totalEventsIntercepted: this.auditLog.length,
      clocks: this.lamport.getAllClocks(),
      recentLogs: this.getAuditLog(15),
    };
  }

  recordEvent(serviceId: string, description: string): number {
    return this.lamport.tickLocal(serviceId, description);
  }

  interceptOutgoingRequest(
    sourceService: string,
    targetService: string,
    endpoint: string,
    action: string,
    transactionId: string,
    payload: any = {}
  ): { headers: Record<string, string>; lamportTimestamp: number } {
    const clockBefore = this.lamport.getClock(sourceService);
    const lamportTimestamp = this.lamport.tickSend(
      sourceService,
      `API Call: [${sourceService}] -> [${targetService}] ${endpoint} (${action})`
    );

    const headers: Record<string, string> = {
      "x-lamport-clock": String(lamportTimestamp),
      "x-lamport-source": sourceService,
      "x-transaction-id": transactionId,
      "x-timestamp": new Date().toISOString(),
    };

    this.sequenceCounter++;
    this.auditLog.push({
      id: `audit-${Date.now()}-${this.sequenceCounter}`,
      sequence: this.sequenceCounter,
      transactionId,
      sourceService,
      targetService,
      endpoint,
      action,
      direction: "OUTGOING_REQUEST",
      lamportTimestamp,
      clockBefore,
      clockAfter: lamportTimestamp,
      headers: { ...headers },
      timestamp: new Date().toISOString(),
      details: `Dispatched RPC payload (${JSON.stringify(payload).length} bytes)`,
    });

    return { headers, lamportTimestamp };
  }

  interceptIncomingRequest(
    targetService: string,
    sourceService: string,
    incomingLamportOrHeaders: number | Record<string, string>,
    endpoint: string,
    action: string,
    transactionId: string,
    headers: Record<string, string> = {}
  ): { clockBefore: number; clockAfter: number; lamportTimestamp: number; headers: Record<string, string> } {
    const clockBefore = this.lamport.getClock(targetService);
    const incomingClock =
      typeof incomingLamportOrHeaders === "number"
        ? incomingLamportOrHeaders
        : Number(incomingLamportOrHeaders?.["x-lamport-clock"]) || clockBefore;
    const finalHeaders =
      typeof incomingLamportOrHeaders === "object" ? incomingLamportOrHeaders : headers;
    const lamportTimestamp = this.lamport.tickReceive(
      targetService,
      incomingClock,
      `Received API Request: [${sourceService}] -> [${targetService}] ${endpoint} (${action})`
    );

    this.sequenceCounter++;
    this.auditLog.push({
      id: `audit-${Date.now()}-${this.sequenceCounter}`,
      sequence: this.sequenceCounter,
      transactionId,
      sourceService,
      targetService,
      endpoint,
      action,
      direction: "INCOMING_REQUEST",
      lamportTimestamp,
      clockBefore,
      clockAfter: lamportTimestamp,
      headers: { ...finalHeaders },
      timestamp: new Date().toISOString(),
      details: `Clock adjusted from ${clockBefore} to max(${clockBefore}, ${incomingClock}) + 1 = ${lamportTimestamp}`,
    });

    return { clockBefore, clockAfter: lamportTimestamp, lamportTimestamp, headers: finalHeaders };
  }

  interceptOutgoingResponse(
    sourceService: string,
    targetService: string,
    endpoint: string,
    action: string,
    transactionId: string,
    status = "SUCCESS"
  ): { headers: Record<string, string>; lamportTimestamp: number } {
    const clockBefore = this.lamport.getClock(sourceService);
    const lamportTimestamp = this.lamport.tickSend(
      sourceService,
      `API Response: [${sourceService}] -> [${targetService}] ${endpoint} (${action}) [${status}]`
    );

    const headers: Record<string, string> = {
      "x-lamport-clock": String(lamportTimestamp),
      "x-lamport-source": sourceService,
      "x-transaction-id": transactionId,
      "x-response-status": status,
      "x-timestamp": new Date().toISOString(),
    };

    this.sequenceCounter++;
    this.auditLog.push({
      id: `audit-${Date.now()}-${this.sequenceCounter}`,
      sequence: this.sequenceCounter,
      transactionId,
      sourceService,
      targetService,
      endpoint,
      action,
      direction: "OUTGOING_RESPONSE",
      lamportTimestamp,
      clockBefore,
      clockAfter: lamportTimestamp,
      headers: { ...headers },
      timestamp: new Date().toISOString(),
      details: `Generated response with status: ${status}`,
    });

    return { headers, lamportTimestamp };
  }

  interceptIncomingResponse(
    receivingService: string,
    respondingService: string,
    incomingLamportOrHeaders: number | Record<string, string>,
    endpoint: string,
    action: string,
    transactionId: string,
    headers: Record<string, string> = {}
  ): { clockBefore: number; clockAfter: number; lamportTimestamp: number; headers: Record<string, string> } {
    const clockBefore = this.lamport.getClock(receivingService);
    const incomingClock =
      typeof incomingLamportOrHeaders === "number"
        ? incomingLamportOrHeaders
        : Number(incomingLamportOrHeaders?.["x-lamport-clock"]) || clockBefore;
    const finalHeaders =
      typeof incomingLamportOrHeaders === "object" ? incomingLamportOrHeaders : headers;
    const lamportTimestamp = this.lamport.tickReceive(
      receivingService,
      incomingClock,
      `Received Response: [${respondingService}] -> [${receivingService}] ${endpoint} (${action})`
    );

    this.sequenceCounter++;
    this.auditLog.push({
      id: `audit-${Date.now()}-${this.sequenceCounter}`,
      sequence: this.sequenceCounter,
      transactionId,
      sourceService: respondingService,
      targetService: receivingService,
      endpoint,
      action,
      direction: "INCOMING_RESPONSE",
      lamportTimestamp,
      clockBefore,
      clockAfter: lamportTimestamp,
      headers: { ...finalHeaders },
      timestamp: new Date().toISOString(),
      details: `Response received. Lamport clock converged to ${lamportTimestamp}`,
    });

    return { clockBefore, clockAfter: lamportTimestamp, lamportTimestamp, headers: finalHeaders };
  }

  reset() {
    this.auditLog = [];
    this.sequenceCounter = 0;
  }
}

// ----------------------------------------------------------------------------
// 3. Distributed Mutual Exclusion (Ricart-Agrawala & Token-Ring)
// ----------------------------------------------------------------------------

export interface MutexRequestResult {
  algorithm: "Ricart-Agrawala" | "Token-Ring";
  requestingNode: string;
  resource: string;
  granted: boolean;
  messagesExchanged: number;
  trace: { step: number; event: string; detail: string }[];
  selfStudyNote: string;
}

export class DistributedMutexManager {
  private currentLockHolder: string | null = null;
  private queue: string[] = [];

  requestLock(nodeId: string, algorithm: "Ricart-Agrawala" | "Token-Ring" = "Ricart-Agrawala"): MutexRequestResult {
    const trace = [];
    let step = 1;

    trace.push({
      step: step++,
      event: "REQUEST_INITIATED",
      detail: `${nodeId} requests exclusive mutual exclusion lock for atomic core-banking ledger mutation.`,
    });

    if (algorithm === "Ricart-Agrawala") {
      trace.push({
        step: step++,
        event: "TIMESTAMPED_REQUEST_BROADCAST",
        detail: `${nodeId} multicasts REQUEST(timestamp=T, nodeId=${nodeId}) to all other distributed bank nodes.`,
      });

      if (!this.currentLockHolder) {
        this.currentLockHolder = nodeId;
        trace.push({
          step: step++,
          event: "ALL_REPLIES_RECEIVED",
          detail: `All participating nodes reply with OK. ${nodeId} enters Critical Section (CS) to mutate account balance.`,
        });

        return {
          algorithm: "Ricart-Agrawala",
          requestingNode: nodeId,
          resource: "Core-Banking Account Ledger Lock",
          granted: true,
          messagesExchanged: 6, // 2*(N-1) messages for N=4
          trace,
          selfStudyNote: "Ricart-Agrawala requires 2*(N-1) messages per CS entry using Lamport timestamps for causal priority.",
        };
      } else {
        this.queue.push(nodeId);
        trace.push({
          step: step++,
          event: "DEFERRED_REPLY",
          detail: `Lock is currently held by ${this.currentLockHolder}. Reply deferred. ${nodeId} queued in FIFO waiter queue.`,
        });

        return {
          algorithm: "Ricart-Agrawala",
          requestingNode: nodeId,
          resource: "Core-Banking Account Ledger Lock",
          granted: false,
          messagesExchanged: 3,
          trace,
          selfStudyNote: "When a process holding CS receives a request with lower timestamp priority, it defers its reply until it exits the Critical Section.",
        };
      }
    } else {
      // Token Ring
      trace.push({
        step: step++,
        event: "TOKEN_RING_CIRCULATION",
        detail: `Mutual exclusion token is circulating sequentially through Bank Nodes.`,
      });

      this.currentLockHolder = nodeId;
      trace.push({
        step: step++,
        event: "TOKEN_SEIZED",
        detail: `${nodeId} seized circulating token and entered Critical Section.`,
      });

      return {
        algorithm: "Token-Ring",
        requestingNode: nodeId,
        resource: "Core-Banking Account Ledger Lock",
        granted: true,
        messagesExchanged: 4,
        trace,
        selfStudyNote: "In Token Ring mutual exclusion, only the holder of the circulating token may enter the critical section. No starvation is possible as the token rotates predictably.",
      };
    }
  }

  releaseLock(nodeId: string) {
    if (this.currentLockHolder === nodeId) {
      this.currentLockHolder = null;
      const next = this.queue.shift();
      if (next) {
        this.currentLockHolder = next;
        return { releasedBy: nodeId, nextHolder: next };
      }
      return { releasedBy: nodeId, nextHolder: null };
    }
    return { releasedBy: nodeId, message: "Node was not holding lock" };
  }
}

// ----------------------------------------------------------------------------
// 4. Lodha and Kshemkalyani's Fair Mutual Exclusion Algorithm
// ----------------------------------------------------------------------------

export interface LKRequest {
  nodeId: string;
  timestamp: number;
  sequence: number;
}

export interface LKExecutionStep {
  step: number;
  actor: string;
  action: string;
  detail: string;
  clock: number;
}

export interface LKResult {
  algorithm: "Lodha-Kshemkalyani-Fair-Mutex";
  requestingNode: string;
  granted: boolean;
  priorityOrder: string[];
  messagesExchanged: number;
  trace: LKExecutionStep[];
  fairnessGuarantee: string;
}

export class LodhaKshemkalyaniMutexManager {
  private lockHolder: string | null = null;
  private waitingQueue: LKRequest[] = [];
  private sequenceCounter = 0;

  requestLock(nodeId: string, logicalClock = 1): LKResult {
    this.sequenceCounter += 1;
    const req: LKRequest = {
      nodeId,
      timestamp: logicalClock,
      sequence: this.sequenceCounter,
    };

    const trace: LKExecutionStep[] = [];
    let stepNum = 1;

    trace.push({
      step: stepNum++,
      actor: nodeId,
      action: "REQUEST_MUTEX",
      detail: `Node ${nodeId} requests critical section with Lamport timestamp L=${logicalClock} (Seq #${this.sequenceCounter})`,
      clock: logicalClock,
    });

    if (!this.lockHolder) {
      this.lockHolder = nodeId;
      trace.push({
        step: stepNum++,
        actor: nodeId,
        action: "ENTER_CS",
        detail: `No conflicting CS lock active. Node ${nodeId} acquires fair mutex immediately.`,
        clock: logicalClock,
      });

      return {
        algorithm: "Lodha-Kshemkalyani-Fair-Mutex",
        requestingNode: nodeId,
        granted: true,
        priorityOrder: [nodeId],
        messagesExchanged: 3,
        trace,
        fairnessGuarantee: "Bounded Waiting & FIFO Fairness: Strictly prevents starvation by causal timestamp ordering (L_i, i).",
      };
    } else {
      this.waitingQueue.push(req);
      this.waitingQueue.sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence);

      trace.push({
        step: stepNum++,
        actor: nodeId,
        action: "QUEUED_FAIRLY",
        detail: `Lock held by ${this.lockHolder}. Node ${nodeId} queued fairly. Position in priority order: #${this.waitingQueue.findIndex((r) => r.nodeId === nodeId) + 1}`,
        clock: logicalClock,
      });

      return {
        algorithm: "Lodha-Kshemkalyani-Fair-Mutex",
        requestingNode: nodeId,
        granted: false,
        priorityOrder: [this.lockHolder, ...this.waitingQueue.map((r) => r.nodeId)],
        messagesExchanged: 2,
        trace,
        fairnessGuarantee: "Strict FIFO / Causal Priority: Guarantees 0-starvation under heavy interbank concurrency.",
      };
    }
  }

  getState() {
    return {
      currentHolder: this.lockHolder,
      waitingQueue: [...this.waitingQueue],
    };
  }

  releaseLock(nodeId: string) {
    if (this.lockHolder === nodeId) {
      this.lockHolder = null;
      const next = this.waitingQueue.shift();
      if (next) {
        this.lockHolder = next.nodeId;
        return { releasedBy: nodeId, nextHolder: next.nodeId, remainingQueue: this.waitingQueue };
      }
      return { releasedBy: nodeId, nextHolder: null, remainingQueue: [] };
    }
    return { releasedBy: nodeId, message: "Node was not holding lock" };
  }
}

// ----------------------------------------------------------------------------
// 5. Vector Clocks (Mattern 1989 & Fidge 1988)
// ----------------------------------------------------------------------------

export type VectorClock = [number, number, number, number];

export class VectorClockManager {
  private vectors: Map<string, VectorClock> = new Map();
  private history: Array<{
    id: string;
    nodeId: string;
    eventType: "LOCAL" | "SEND" | "RECEIVE";
    vector: VectorClock;
    description: string;
    timestamp: string;
  }> = [];

  public static nodeIndices: Record<string, number> = {
    "sender-bank": 0,
    "transaction-service": 1,
    "npci": 2,
    "receiver-bank": 3,
  };

  public static nodeNames: Record<string, string> = {
    "sender-bank": "Sender Bank Service",
    "transaction-service": "Transaction Service",
    "npci": "NPCI Simulator",
    "receiver-bank": "Receiver Bank Service",
  };

  constructor() {
    this.reset();
  }

  reset() {
    this.vectors.set("sender-bank", [0, 0, 0, 0]);
    this.vectors.set("transaction-service", [0, 0, 0, 0]);
    this.vectors.set("npci", [0, 0, 0, 0]);
    this.vectors.set("receiver-bank", [0, 0, 0, 0]);
    this.history = [];
  }

  getVector(nodeId: string): VectorClock {
    const v = this.vectors.get(nodeId);
    return v ? [...v] : [0, 0, 0, 0];
  }

  getAllVectors() {
    return Array.from(this.vectors.entries()).map(([id, vector]) => {
      const last = this.history.filter((h) => h.nodeId === id).slice(-1)[0];
      return {
        id,
        name: VectorClockManager.nodeNames[id] || id,
        vector: [...vector],
        lastEvent: last?.description || "Initialized (V=[0,0,0,0])",
        lastTimestamp: last?.timestamp || new Date().toISOString(),
      };
    });
  }

  getHistory(limit = 50) {
    return [...this.history].reverse().slice(0, limit);
  }

  tickLocal(nodeId: string, description: string): VectorClock {
    const idx = VectorClockManager.nodeIndices[nodeId] ?? 0;
    const v = this.getVector(nodeId);
    v[idx] += 1;
    this.vectors.set(nodeId, v);
    this.history.push({
      id: `vec-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      nodeId,
      eventType: "LOCAL",
      vector: [...v],
      description,
      timestamp: new Date().toISOString(),
    });
    return [...v];
  }

  tickSend(fromNode: string, toNode: string, description: string): VectorClock {
    const idx = VectorClockManager.nodeIndices[fromNode] ?? 1;
    const v = this.getVector(fromNode);
    v[idx] += 1;
    this.vectors.set(fromNode, v);
    this.history.push({
      id: `vec-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      nodeId: fromNode,
      eventType: "SEND",
      vector: [...v],
      description: `${description} (to ${toNode})`,
      timestamp: new Date().toISOString(),
    });
    return [...v];
  }

  tickReceive(toNode: string, fromNode: string, incomingVector: VectorClock, description: string): VectorClock {
    const idx = VectorClockManager.nodeIndices[toNode] ?? 0;
    const current = this.getVector(toNode);
    const updated: VectorClock = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      updated[i] = Math.max(current[i] || 0, incomingVector[i] || 0);
    }
    updated[idx] += 1;
    this.vectors.set(toNode, updated);
    this.history.push({
      id: `vec-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      nodeId: toNode,
      eventType: "RECEIVE",
      vector: [...updated],
      description: `${description} (from ${fromNode})`,
      timestamp: new Date().toISOString(),
    });
    return [...updated];
  }

  static compare(vectorA: VectorClock, vectorB: VectorClock): {
    relation: "EQUAL" | "HAPPENS_BEFORE_A_B" | "HAPPENS_BEFORE_B_A" | "CONCURRENT";
    details: string;
    causalityExplanation?: string;
  } {
    let aLessOrEqual = true;
    let bLessOrEqual = true;
    let aStrictlyLess = false;
    let bStrictlyLess = false;

    for (let i = 0; i < 4; i++) {
      if (vectorA[i] > vectorB[i]) {
        aLessOrEqual = false;
      }
      if (vectorB[i] > vectorA[i]) {
        bLessOrEqual = false;
      }
      if (vectorA[i] < vectorB[i]) {
        aStrictlyLess = true;
      }
      if (vectorB[i] < vectorA[i]) {
        bStrictlyLess = true;
      }
    }

    if (aLessOrEqual && bLessOrEqual) {
      return {
        relation: "EQUAL",
        details: "Vectors are identical (simultaneous/same event cut).",
      };
    }
    if (aLessOrEqual && aStrictlyLess) {
      return {
        relation: "HAPPENS_BEFORE_A_B",
        details: `A causally precedes B: [${vectorA.join(",")}] -> [${vectorB.join(",")}]`,
        causalityExplanation: "Event A is in the causal past of Event B (Mattern 1989 / Fidge 1988).",
      };
    }
    if (bLessOrEqual && bStrictlyLess) {
      return {
        relation: "HAPPENS_BEFORE_B_A",
        details: `B causally precedes A: [${vectorB.join(",")}] -> [${vectorA.join(",")}]`,
        causalityExplanation: "Event B is in the causal past of Event A.",
      };
    }
    return {
      relation: "CONCURRENT",
      details: `Events are causally independent / concurrent: [${vectorA.join(",")}] || [${vectorB.join(",")}]`,
      causalityExplanation: "Neither event causally precedes the other; executed in parallel across distributed nodes.",
    };
  }
}

// ----------------------------------------------------------------------------
// 6. Physical Clock Synchronization (Berkeley Algorithm)
// ----------------------------------------------------------------------------

export interface DistributedClockNode {
  id: string;
  name: string;
  effectiveOffsetMs: number;
  status: "SYNCHRONIZED" | "DESYNCHRONIZED";
  driftMs: number;
  lastSyncTimestamp: string;
}

export class ClockSyncManager {
  private initialOffsets: Record<string, number> = {
    "sender-bank": -3420,
    "transaction-service": 0,
    "npci": -2150,
    "receiver-bank": 1850,
  };

  private clocks: Map<string, DistributedClockNode> = new Map();

  constructor() {
    this.resetClocks();
  }

  resetClocks() {
    const names: Record<string, string> = {
      "sender-bank": "Sender Bank Service",
      "transaction-service": "Transaction Service",
      "npci": "NPCI Simulator Switch",
      "receiver-bank": "Receiver Bank Service",
    };
    for (const [id, offset] of Object.entries(this.initialOffsets)) {
      this.clocks.set(id, {
        id,
        name: names[id] || id,
        effectiveOffsetMs: offset,
        status: offset === 0 ? "SYNCHRONIZED" : "DESYNCHRONIZED",
        driftMs: offset,
        lastSyncTimestamp: new Date().toISOString(),
      });
    }
  }

  getClocks(): DistributedClockNode[] {
    return Array.from(this.clocks.values());
  }

  introduceDrift(nodeId: string, deltaMs: number): DistributedClockNode | null {
    const node = this.clocks.get(nodeId);
    if (!node) return null;
    node.effectiveOffsetMs += deltaMs;
    node.driftMs += deltaMs;
    node.status = "DESYNCHRONIZED";
    node.lastSyncTimestamp = new Date().toISOString();
    return { ...node };
  }

  synchronize(): {
    clocks: DistributedClockNode[];
    offsets: Record<string, number>;
    averageOffsetMs: number;
    consensusOffsetMs: number;
    adjustments: Record<string, number>;
  } {
    const nodes = Array.from(this.clocks.values());
    const sum = nodes.reduce((acc, c) => acc + c.effectiveOffsetMs, 0);
    const avg = Math.round(sum / nodes.length);
    const offsets: Record<string, number> = {};
    const adjustments: Record<string, number> = {};

    for (const node of nodes) {
      offsets[node.id] = node.effectiveOffsetMs;
      adjustments[node.id] = avg - node.effectiveOffsetMs;
      node.effectiveOffsetMs = avg;
      node.status = "SYNCHRONIZED";
      node.driftMs = 0;
      node.lastSyncTimestamp = new Date().toISOString();
    }

    return {
      clocks: this.getClocks(),
      offsets,
      averageOffsetMs: avg,
      consensusOffsetMs: avg,
      adjustments,
    };
  }
}

// ----------------------------------------------------------------------------
// 7. Beacon Protocol (Heartbeat-Based Failure Detection)
// ----------------------------------------------------------------------------

export interface BeaconNode {
  id: string;
  name: string;
  status: "HEALTHY" | "UNREACHABLE";
  lastBeaconEpochMs: number;
  missedHeartbeats: number;
  lastSeenIso: string;
}

export class BeaconProtocolManager {
  public beacons: Map<string, BeaconNode> = new Map();

  constructor() {
    this.reset();
  }

  reset() {
    const nodes = [
      { id: "sender-bank", name: "Sender Bank Service" },
      { id: "transaction-service", name: "Transaction Service" },
      { id: "npci", name: "NPCI Simulator Switch" },
      { id: "receiver-bank", name: "Receiver Bank Service" },
    ];
    this.beacons.clear();
    const now = Date.now();
    for (const n of nodes) {
      this.beacons.set(n.id, {
        id: n.id,
        name: n.name,
        status: "HEALTHY",
        lastBeaconEpochMs: now,
        missedHeartbeats: 0,
        lastSeenIso: new Date(now).toISOString(),
      });
    }
  }

  getBeacons(): BeaconNode[] {
    return Array.from(this.beacons.values());
  }

  tickBeacons(isNodeDownFn?: (nodeId: string) => boolean) {
    const now = Date.now();
    for (const beacon of this.beacons.values()) {
      const isDown = isNodeDownFn ? isNodeDownFn(beacon.id) : false;
      const ageMs = now - beacon.lastBeaconEpochMs;
      if (isDown || ageMs > 5000) {
        beacon.status = "UNREACHABLE";
        beacon.missedHeartbeats = Math.max(1, Math.floor(ageMs / 2000));
      } else {
        beacon.status = "HEALTHY";
        beacon.missedHeartbeats = 0;
      }
    }
  }

  recordManualBeacon(nodeId: string): BeaconNode | null {
    let beacon = this.beacons.get(nodeId);
    const now = Date.now();
    if (!beacon) {
      beacon = {
        id: nodeId,
        name: nodeId,
        status: "HEALTHY",
        lastBeaconEpochMs: now,
        missedHeartbeats: 0,
        lastSeenIso: new Date(now).toISOString(),
      };
      this.beacons.set(nodeId, beacon);
    } else {
      beacon.lastBeaconEpochMs = now;
      beacon.lastSeenIso = new Date(now).toISOString();
      beacon.status = "HEALTHY";
      beacon.missedHeartbeats = 0;
    }
    return { ...beacon };
  }
}

// ----------------------------------------------------------------------------
// 8. Global State Snapshot (Chandy-Lamport Simulator)
// ----------------------------------------------------------------------------

export interface GlobalSnapshotRecord {
  id: string;
  snapshotId: string;
  timestamp: string;
  lamport: number;
  vector: [number, number, number, number];
  consistent: boolean;
  activeTransaction: any;
  accounts: any[];
  failureState: any;
  cutType: string;
}

export class GlobalStateManager {
  private snapshots: GlobalSnapshotRecord[] = [];

  captureSnapshot(
    lamport: number,
    vector: [number, number, number, number],
    activeTxn: any,
    accounts: any[],
    failureState: any
  ): GlobalSnapshotRecord {
    const snapId = `SNAP-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    const snap: GlobalSnapshotRecord = {
      id: snapId,
      snapshotId: snapId,
      timestamp: new Date().toISOString(),
      lamport,
      vector: [...vector],
      consistent: true,
      activeTransaction: activeTxn,
      accounts: Array.isArray(accounts) ? [...accounts] : [],
      failureState: { ...failureState },
      cutType: "Strongly Consistent Causally Ordered Cut (Chandy-Lamport 1985)",
    };
    this.snapshots.push(snap);
    if (this.snapshots.length > 50) this.snapshots.shift();
    return snap;
  }

  getSnapshots(): GlobalSnapshotRecord[] {
    return [...this.snapshots].reverse();
  }
}

// ----------------------------------------------------------------------------
// 9. Distributed Election Algorithms (Bully & Ring)
// ----------------------------------------------------------------------------

export class ElectionAlgorithmManager {
  private priorities: Record<string, number> = {
    "sender-bank": 1,
    "transaction-service": 2,
    "receiver-bank": 3,
    "npci": 4,
  };

  runBullyElection(initiatorId: string, crashedNodeId = "npci") {
    const allNodes = ["sender-bank", "transaction-service", "receiver-bank", "npci"];
    const activeNodes = allNodes.filter((id) => id !== crashedNodeId);
    let highestActive = activeNodes[0];
    for (const id of activeNodes) {
      if ((this.priorities[id] || 0) > (this.priorities[highestActive] || 0)) {
        highestActive = id;
      }
    }

    const trace = [
      { step: 1, action: "COORDINATOR_TIMEOUT", from: initiatorId, detail: `Initiator ${initiatorId} detected crash of coordinator ${crashedNodeId}` },
      { step: 2, action: "ELECTION_BROADCAST", from: initiatorId, detail: `${initiatorId} broadcasts ELECTION to all higher-priority nodes` },
      { step: 3, action: "ANSWER_RECEIVED", from: highestActive, detail: `${highestActive} responds with OK/ANSWER, takes over election` },
      { step: 4, action: "VICTORY_ANNOUNCEMENT", from: highestActive, detail: `${highestActive} broadcasts COORDINATOR message to all active nodes` },
    ];

    return {
      algorithm: "Bully",
      initiator: initiatorId,
      crashedNode: crashedNodeId,
      electedCoordinator: highestActive,
      messagesExchanged: activeNodes.length * 2,
      trace,
    };
  }

  runRingElection(initiatorId: string, crashedNodeId = "npci") {
    const ringOrder = ["sender-bank", "transaction-service", "npci", "receiver-bank"];
    const activeNodes = ringOrder.filter((id) => id !== crashedNodeId);
    let highestActive = activeNodes[0];
    for (const id of activeNodes) {
      if ((this.priorities[id] || 0) > (this.priorities[highestActive] || 0)) {
        highestActive = id;
      }
    }

    const trace = [
      { step: 1, action: "RING_TOKEN_INIT", detail: `${initiatorId} initiates election token with [${initiatorId}]` },
      { step: 2, action: "TOKEN_PASSED", detail: `Token circulates through active ring nodes: ${activeNodes.join(" -> ")}` },
      { step: 3, action: "COORDINATOR_ELECTED", detail: `Token returns to initiator; node ${highestActive} has maximum priority and is elected` },
    ];

    return {
      algorithm: "Ring",
      initiator: initiatorId,
      crashedNode: crashedNodeId,
      electedCoordinator: highestActive,
      messagesExchanged: activeNodes.length + 1,
      activeNodesVisited: activeNodes,
      trace,
    };
  }
}

// ----------------------------------------------------------------------------
// 10. Knapp's 4 Classes of Distributed Deadlock Detection
// ----------------------------------------------------------------------------

export class KnappDeadlockDetectionManager {
  runDetection(category: "EDGE_CHASING" | "PATH_PUSHING" | "DIFFUSION_COMPUTATION" | "GLOBAL_STATE_DETECTION") {
    const cycle = ["Txn-Service", "Sender-Bank", "NPCI", "Receiver-Bank", "Txn-Service"];
    const algorithmNames: Record<string, string> = {
      EDGE_CHASING: "Edge-Chasing (Class 1)",
      PATH_PUSHING: "Path-Pushing (Class 2)",
      DIFFUSION_COMPUTATION: "Diffusion Computation (Class 3)",
      GLOBAL_STATE_DETECTION: "Global State Detection (Class 4)",
    };
    const representativeModels: Record<string, string> = {
      EDGE_CHASING: "Chandy-Misra-Haas Probe",
      PATH_PUSHING: "Obermarck",
      DIFFUSION_COMPUTATION: "Dijkstra-Scholten",
      GLOBAL_STATE_DETECTION: "Kshemkalyani-Singhal",
    };
    const descriptions: Record<string, string> = {
      EDGE_CHASING: "Chandy-Misra-Haas Probe: Initiator sends (initiator, sender, receiver) probe. Probe returned to initiator confirms cyclic dependency.",
      PATH_PUSHING: "Obermarck Path-Pushing: Participating sites send path segments to neighbors. Combined global wait-for graph exposes circular wait.",
      DIFFUSION_COMPUTATION: "Dijkstra-Scholten / Chandy Diffusion: Query message tree diffused across wait edges. Failure of all children to echo indicates deadlock.",
      GLOBAL_STATE_DETECTION: "Kshemkalyani-Singhal / Chandy-Lamport: Consistent snapshot evaluates strongly connected component (SCC) containing a knot.",
    };

    return {
      category,
      algorithmName: algorithmNames[category] || category,
      representativeModel: representativeModels[category] || category,
      deadlockDetected: true,
      cycle,
      participatingNodes: ["Txn-Service", "Sender-Bank", "NPCI", "Receiver-Bank"],
      resolutionStrategy: "Abort transaction with lowest Lamport priority to break circular lock dependency",
      description: descriptions[category] || "Distributed deadlock cycle verified.",
    };
  }
}

// ----------------------------------------------------------------------------
// 11. Distributed Systems Paradigms (RMI, DFS Replication, Serverless)
// ----------------------------------------------------------------------------

export class DistributedSystemsParadigmsManager {
  invokeRMI(method: string, accountUpi: string, amount: number) {
    return {
      paradigm: "Remote Method Invocation (RMI) & Distributed Objects",
      method,
      accountUpi,
      amount,
      targetObject: "RemoteAccountServiceStub",
      result: {
        status: "DEBIT_CONFIRMED",
        accountUpi,
        amount,
        balancePaise: 950000,
        txId: `RMI-${Date.now()}`,
      },
      trace: [
        "1. Client application calls local Stub proxy interface",
        "2. Client Stub marshals method identifier and arguments into byte stream",
        "3. Transport layer dispatches RMI packet over TCP socket",
        "4. Server Skeleton receives packet and demarshals arguments",
        "5. Skeleton invokes target implementation on remote bank object and returns marshaled result",
      ],
    };
  }

  replicateAuditChunk(txnId: string, amount: number) {
    return {
      txnId,
      amount,
      chunkId: `CHUNK-${txnId}`,
      replicationFactor: 3,
      replicaNodes: ["MUM-DC1", "HYD-DC2", "BLR-DC3"],
      consistencyModel: "Quorum Pipeline Acknowledged (R=2, W=2)",
      checksumSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      status: "REPLICATED",
    };
  }

  invokeServerlessWebhook(isWarm: boolean) {
    const containerAllocationMs = isWarm ? 0 : 150;
    const runtimeInitMs = isWarm ? 0 : 45;
    const handlerExecutionMs = 25;
    const totalLatencyMs = containerAllocationMs + runtimeInitMs + handlerExecutionMs;

    return {
      state: isWarm ? "WARM_CONTAINER_REUSED" : "COLD_START_PROVISIONED",
      isWarm,
      functionName: "PaymentFraudVerificationWebhook",
      breakdown: {
        containerAllocationMs,
        runtimeInitMs,
        handlerExecutionMs,
        totalLatencyMs,
      },
    };
  }
}

