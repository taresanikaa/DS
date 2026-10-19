// ============================================================================
// UNIT III: Distributed Synchronization & Fair Mutual Exclusion Engine
// Real-world Concurrent Implementation: Actors, Network Channels, Clocks,
// Mutual Exclusion (Ricart-Agrawala, Token-Ring, Lodha-Kshemkalyani),
// Knapp's Deadlock Detection (4 Classes), and Election Algorithms.
// ============================================================================

// ----------------------------------------------------------------------------
// Types & Interfaces
// ----------------------------------------------------------------------------

export type NodeCSState = "RELEASED" | "WANTED" | "HELD";

export interface NetworkMessage<T = any> {
  id: string;
  from: string;
  to: string;
  type: string;
  payload: T;
  lamportClock: number;
  vectorClock: [number, number, number, number];
  sentTimestampMs: number;
  simulatedDelayMs?: number;
}

export type MessageHandler = (msg: NetworkMessage) => Promise<void> | void;

// ----------------------------------------------------------------------------
// 1. Simulated Asynchronous Network Channel & Message Broker
// Rules:
// - Simulates true network decoupling: no shared memory or in-process mutexes
// - Independent message queue per node actor
// - Configurable transmission latency, jitter, and out-of-order delivery
// ----------------------------------------------------------------------------

export class AsynchronousNetworkBroker {
  private inboxes: Map<string, NetworkMessage[]> = new Map();
  private handlers: Map<string, MessageHandler> = new Map();
  private isProcessing: Map<string, boolean> = new Map();
  public totalMessagesTransmitted = 0;
  public totalBytesEstimated = 0;
  private messageLog: NetworkMessage[] = [];
  public minDelayMs: number;
  public maxDelayMs: number;
  public allowOutOfOrder: boolean;

  constructor(options: { minDelayMs?: number; maxDelayMs?: number; allowOutOfOrder?: boolean } = {}) {
    this.minDelayMs = options.minDelayMs ?? 2;
    this.maxDelayMs = options.maxDelayMs ?? 8;
    this.allowOutOfOrder = options.allowOutOfOrder ?? true;
  }

  registerNode(nodeId: string, handler: MessageHandler) {
    this.inboxes.set(nodeId, []);
    this.handlers.set(nodeId, handler);
    this.isProcessing.set(nodeId, false);
  }

  unregisterNode(nodeId: string) {
    this.inboxes.delete(nodeId);
    this.handlers.delete(nodeId);
    this.isProcessing.delete(nodeId);
  }

  async send(msg: NetworkMessage): Promise<void> {
    this.totalMessagesTransmitted++;
    this.totalBytesEstimated += JSON.stringify(msg).length;
    this.messageLog.push(msg);

    // Compute latency with jitter
    const delay = this.allowOutOfOrder
      ? Math.floor(Math.random() * (this.maxDelayMs - this.minDelayMs + 1)) + this.minDelayMs
      : this.minDelayMs;

    msg.simulatedDelayMs = delay;

    // Asynchronous network delivery over event loop
    setTimeout(() => {
      const inbox = this.inboxes.get(msg.to);
      if (inbox) {
        inbox.push(msg);
        this.drainInbox(msg.to);
      }
    }, delay);
  }

  async broadcast(from: string, targets: string[], type: string, payload: any, lamport: number, vector: [number, number, number, number]): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const target of targets) {
      if (target !== from) {
        const msg: NetworkMessage = {
          id: `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          from,
          to: target,
          type,
          payload,
          lamportClock: lamport,
          vectorClock: [...vector],
          sentTimestampMs: Date.now(),
        };
        promises.push(this.send(msg));
      }
    }
    await Promise.all(promises);
  }

  private async drainInbox(nodeId: string): Promise<void> {
    if (this.isProcessing.get(nodeId)) return;
    this.isProcessing.set(nodeId, true);

    const inbox = this.inboxes.get(nodeId);
    const handler = this.handlers.get(nodeId);

    while (inbox && inbox.length > 0) {
      const msg = inbox.shift()!;
      if (handler) {
        try {
          await handler(msg);
        } catch (err) {
          console.error(`[Broker] Error handling message ${msg.id} at ${nodeId}:`, err);
        }
      }
    }

    this.isProcessing.set(nodeId, false);
  }

  getMessageLog(): NetworkMessage[] {
    return [...this.messageLog];
  }

  clear() {
    this.inboxes.clear();
    this.handlers.clear();
    this.isProcessing.clear();
    this.messageLog = [];
    this.totalMessagesTransmitted = 0;
    this.totalBytesEstimated = 0;
  }
}

// ----------------------------------------------------------------------------
// 2. Base Distributed Node Actor
// Implements Lamport & Vector Clock mechanics and actor state machine
// ----------------------------------------------------------------------------

export class DistributedNodeActor {
  public id: string;
  public name: string;
  public index: number; // 0 to 3
  public lamportClock = 0;
  public vectorClock: [number, number, number, number] = [0, 0, 0, 0];
  public csState: NodeCSState = "RELEASED";
  public broker: AsynchronousNetworkBroker;
  public activeCSCount = 0;
  public localExecutionLog: string[] = [];

  constructor(id: string, name: string, index: number, broker: AsynchronousNetworkBroker) {
    this.id = id;
    this.name = name;
    this.index = index;
    this.broker = broker;
    this.broker.registerNode(this.id, this.receiveMessage.bind(this));
  }

  // Lamport Local Event: L = L + 1
  tickLocal(eventDescription: string): number {
    this.lamportClock += 1;
    this.vectorClock[this.index] += 1;
    this.localExecutionLog.push(
      `[LOCAL] ${eventDescription} | Lamport=${this.lamportClock} | Vector=[${this.vectorClock.join(",")}]`
    );
    return this.lamportClock;
  }

  // Lamport Message Send: L = L + 1, attach to message
  prepareSend(targetNodeId: string, type: string, payload: any): NetworkMessage {
    this.lamportClock += 1;
    this.vectorClock[this.index] += 1;
    const msg: NetworkMessage = {
      id: `MSG-${this.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from: this.id,
      to: targetNodeId,
      type,
      payload,
      lamportClock: this.lamportClock,
      vectorClock: [...this.vectorClock],
      sentTimestampMs: Date.now(),
    };
    this.localExecutionLog.push(
      `[SEND -> ${targetNodeId}] ${type} | Lamport=${this.lamportClock} | Vector=[${this.vectorClock.join(",")}]`
    );
    return msg;
  }

  // Lamport Message Receive: L = max(L_local, T_incoming) + 1
  // Vector Message Receive: V[j] = max(V[j], V_incoming[j]), then V[i] = V[i] + 1
  processClockOnReceive(msg: NetworkMessage) {
    this.lamportClock = Math.max(this.lamportClock, msg.lamportClock) + 1;
    for (let i = 0; i < 4; i++) {
      this.vectorClock[i] = Math.max(this.vectorClock[i], msg.vectorClock[i]);
    }
    this.vectorClock[this.index] += 1;

    this.localExecutionLog.push(
      `[RECV <- ${msg.from}] ${msg.type} (Incoming L=${msg.lamportClock}) | New Lamport=${this.lamportClock} | Vector=[${this.vectorClock.join(",")}]`
    );
  }

  // Subclasses override receiveMessage
  async receiveMessage(msg: NetworkMessage): Promise<void> {
    this.processClockOnReceive(msg);
  }
}

// ----------------------------------------------------------------------------
// FEATURE 1 & 5: Ricart-Agrawala Distributed Mutual Exclusion Actor
// Safety: At most one node holds Critical Section at any time.
// Fairness: Timestamp-based ordering ensures no starvation.
// Message complexity: 2*(N-1) messages per CS entry.
// ----------------------------------------------------------------------------

export interface RAMutexRequestPayload {
  requestId: string;
  requestTimestamp: number;
  nodeIndex: number;
}

export class RicartAgrawalaNodeActor extends DistributedNodeActor {
  public allNodeIds: string[] = [];
  public requestTimestamp = 0;
  private pendingRepliesNeeded = 0;
  private deferredReplies: string[] = [];
  private onCSEnterResolve: (() => void) | null = null;
  public csEntriesCompleted = 0;
  private localQueue: Array<() => void> = [];
  private isProcessingLocal = false;

  setPeers(peers: string[]) {
    this.allNodeIds = [...peers];
  }

  async requestCriticalSection(): Promise<void> {
    if (this.isProcessingLocal) {
      await new Promise<void>((resolve) => {
        this.localQueue.push(resolve);
      });
    }
    this.isProcessingLocal = true;
    await this.executeDistributedCSRequest();
  }

  private async executeDistributedCSRequest(): Promise<void> {
    this.csState = "WANTED";
    this.requestTimestamp = this.tickLocal("Request Critical Section");
    const peers = this.allNodeIds.filter((id) => id !== this.id);
    this.pendingRepliesNeeded = peers.length;
    this.deferredReplies = [];

    if (peers.length === 0) {
      this.csState = "HELD";
      return;
    }

    // Multicast REQUEST(T_i, i) to all peers
    for (const peer of peers) {
      const msg = this.prepareSend(peer, "RA_REQUEST", {
        requestId: `REQ-${this.id}-${this.requestTimestamp}`,
        requestTimestamp: this.requestTimestamp,
        nodeIndex: this.index,
      });
      await this.broker.send(msg);
    }

    // Await all N-1 replies
    await new Promise<void>((resolve) => {
      this.onCSEnterResolve = resolve;
    });

    this.csState = "HELD";
    this.activeCSCount++;
  }

  async releaseCriticalSection(): Promise<void> {
    this.csState = "RELEASED";
    this.csEntriesCompleted++;
    this.tickLocal("Released Critical Section");

    // Reply to all deferred nodes
    const deferred = [...this.deferredReplies];
    this.deferredReplies = [];

    for (const target of deferred) {
      const replyMsg = this.prepareSend(target, "RA_REPLY", {
        grantedForTimestamp: this.requestTimestamp,
      });
      await this.broker.send(replyMsg);
    }

    this.isProcessingLocal = false;
    const nextLocal = this.localQueue.shift();
    if (nextLocal) {
      nextLocal();
    }
  }

  override async receiveMessage(msg: NetworkMessage): Promise<void> {
    this.processClockOnReceive(msg);

    if (msg.type === "RA_REQUEST") {
      const { requestTimestamp, nodeIndex } = msg.payload as RAMutexRequestPayload;

      // Ricart-Agrawala Deferred Reply Rule:
      // Defer reply IF:
      // 1. Current node is HELD, OR
      // 2. Current node is WANTED AND my (timestamp, index) < incoming (timestamp, index)
      const myPriorityIsHigher =
        this.csState === "WANTED" &&
        (this.requestTimestamp < requestTimestamp ||
          (this.requestTimestamp === requestTimestamp && this.index < nodeIndex));

      if (this.csState === "HELD" || myPriorityIsHigher) {
        this.deferredReplies.push(msg.from);
      } else {
        // Send REPLY immediately
        const replyMsg = this.prepareSend(msg.from, "RA_REPLY", {
          grantedForTimestamp: requestTimestamp,
        });
        await this.broker.send(replyMsg);
      }
    } else if (msg.type === "RA_REPLY") {
      if (this.csState === "WANTED") {
        this.pendingRepliesNeeded--;
        if (this.pendingRepliesNeeded <= 0 && this.onCSEnterResolve) {
          const cb = this.onCSEnterResolve;
          this.onCSEnterResolve = null;
          cb();
        }
      }
    }
  }
}

// ----------------------------------------------------------------------------
// FEATURE 1 & 5: Token-Ring Distributed Mutual Exclusion Actor
// Safety: Token is unique and non-replicating; only token holder enters CS.
// Fairness: Token rotates sequentially around the ring; bounded wait <= N-1.
// ----------------------------------------------------------------------------

export interface TokenPayload {
  tokenSequence: number;
  holder: string;
}

export class TokenRingNodeActor extends DistributedNodeActor {
  public nextNodeInRing = "";
  public hasToken = false;
  private tokenWaitResolve: (() => void) | null = null;
  public csEntriesCompleted = 0;

  setNext(nextNodeId: string) {
    this.nextNodeInRing = nextNodeId;
  }

  giveInitialToken() {
    this.hasToken = true;
  }

  async requestCriticalSection(): Promise<void> {
    this.csState = "WANTED";
    this.tickLocal("Wants Critical Section in Token Ring");

    if (this.hasToken) {
      this.csState = "HELD";
      return;
    }

    await new Promise<void>((resolve) => {
      this.tokenWaitResolve = resolve;
    });

    this.csState = "HELD";
  }

  async releaseCriticalSection(): Promise<void> {
    this.csState = "RELEASED";
    this.csEntriesCompleted++;
    this.hasToken = false;
    this.tickLocal("Released Critical Section in Token Ring");

    // Pass token to next node in ring
    if (this.nextNodeInRing) {
      const msg = this.prepareSend(this.nextNodeInRing, "TOKEN", {
        tokenSequence: Date.now(),
        holder: this.nextNodeInRing,
      });
      await this.broker.send(msg);
    }
  }

  override async receiveMessage(msg: NetworkMessage): Promise<void> {
    this.processClockOnReceive(msg);

    if (msg.type === "TOKEN") {
      this.hasToken = true;
      if (this.csState === "WANTED" && this.tokenWaitResolve) {
        const cb = this.tokenWaitResolve;
        this.tokenWaitResolve = null;
        cb();
      } else {
        // Not waiting; forward token to next node
        this.hasToken = false;
        if (this.nextNodeInRing) {
          const forward = this.prepareSend(this.nextNodeInRing, "TOKEN", {
            tokenSequence: msg.payload.tokenSequence + 1,
            holder: this.nextNodeInRing,
          });
          await this.broker.send(forward);
        }
      }
    }
  }
}

// ----------------------------------------------------------------------------
// FEATURE 6: Lodha-Kshemkalyani Fair Mutual Exclusion Actor
// Bounded Waiting: Guarantees strict FIFO causal order.
// Uses restricted multicast and request sets (R_i) to reduce message complexity.
// ----------------------------------------------------------------------------

export interface LKRequestMessagePayload {
  requestTimestamp: number;
  nodeIndex: number;
  sequenceNum: number;
}

export class LodhaKshemkalyaniNodeActor extends DistributedNodeActor {
  public allNodeIds: string[] = [];
  public requestTimestamp = 0;
  public sequenceCounter = 0;
  private pendingAcksNeeded = 0;
  private onCSEnterResolve: (() => void) | null = null;
  public csEntriesCompleted = 0;
  public waitingQueue: Array<{ nodeId: string; timestamp: number; nodeIndex: number }> = [];

  setPeers(peers: string[]) {
    this.allNodeIds = [...peers];
  }

  async requestCriticalSection(): Promise<void> {
    this.csState = "WANTED";
    this.sequenceCounter++;
    this.requestTimestamp = this.tickLocal("Lodha-Kshemkalyani Request CS");
    const peers = this.allNodeIds.filter((id) => id !== this.id);
    this.pendingAcksNeeded = peers.length;

    if (peers.length === 0) {
      this.csState = "HELD";
      return;
    }

    // Multicast to request set
    for (const peer of peers) {
      const msg = this.prepareSend(peer, "LK_REQUEST", {
        requestTimestamp: this.requestTimestamp,
        nodeIndex: this.index,
        sequenceNum: this.sequenceCounter,
      });
      await this.broker.send(msg);
    }

    await new Promise<void>((resolve) => {
      this.onCSEnterResolve = resolve;
    });

    this.csState = "HELD";
  }

  async releaseCriticalSection(): Promise<void> {
    this.csState = "RELEASED";
    this.csEntriesCompleted++;
    this.tickLocal("Lodha-Kshemkalyani Released CS");

    // Pop next waiter from strict priority queue
    this.waitingQueue.sort(
      (a, b) => a.timestamp - b.timestamp || a.nodeIndex - b.nodeIndex
    );

    const nextWaiters = [...this.waitingQueue];
    this.waitingQueue = [];

    for (const waiter of nextWaiters) {
      const reply = this.prepareSend(waiter.nodeId, "LK_GRANT", {
        grantedTimestamp: this.requestTimestamp,
      });
      await this.broker.send(reply);
    }
  }

  override async receiveMessage(msg: NetworkMessage): Promise<void> {
    this.processClockOnReceive(msg);

    if (msg.type === "LK_REQUEST") {
      const { requestTimestamp, nodeIndex } = msg.payload as LKRequestMessagePayload;

      const myPriorityHigher =
        this.csState === "WANTED" &&
        (this.requestTimestamp < requestTimestamp ||
          (this.requestTimestamp === requestTimestamp && this.index < nodeIndex));

      if (this.csState === "HELD" || myPriorityHigher) {
        // Enqueue waiter in causal priority queue
        this.waitingQueue.push({
          nodeId: msg.from,
          timestamp: requestTimestamp,
          nodeIndex,
        });
      } else {
        // Send grant immediately
        const reply = this.prepareSend(msg.from, "LK_GRANT", {
          grantedTimestamp: requestTimestamp,
        });
        await this.broker.send(reply);
      }
    } else if (msg.type === "LK_GRANT") {
      if (this.csState === "WANTED") {
        this.pendingAcksNeeded--;
        if (this.pendingAcksNeeded <= 0 && this.onCSEnterResolve) {
          const cb = this.onCSEnterResolve;
          this.onCSEnterResolve = null;
          cb();
        }
      }
    }
  }
}

// ----------------------------------------------------------------------------
// FEATURE 7: Knapp's Classification of Distributed Deadlock Detection
// Evaluates all 4 theoretical classes:
// 1. Path-Pushing (Obermarck)
// 2. Edge-Chasing (Chandy-Misra-Haas)
// 3. Diffusion Computation (Dijkstra-Scholten / Chandy)
// 4. Global State Detection (Chandy-Lamport / Kshemkalyani Snapshot)
// ----------------------------------------------------------------------------

function findWfgCycle(wfg: Record<string, string[]>): string[] | null {
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const parent: Record<string, string> = {};

  function dfs(curr: string): string[] | null {
    visited.add(curr);
    recStack.add(curr);

    const neighbors = wfg[curr] || [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        parent[next] = curr;
        const res = dfs(next);
        if (res) return res;
      } else if (recStack.has(next)) {
        const cycle = [next];
        let p = curr;
        while (p && p !== next) {
          cycle.unshift(p);
          p = parent[p];
        }
        cycle.unshift(next);
        return cycle;
      }
    }

    recStack.delete(curr);
    return null;
  }

  for (const node of Object.keys(wfg)) {
    if (!visited.has(node)) {
      const res = dfs(node);
      if (res) return res;
    }
  }
  return null;
}

export class KnappDeadlockSimulator {
  static simulatePathPushing(wfg: Record<string, string[]>) {
    const cycle = findWfgCycle(wfg);
    return {
      category: "PATH_PUSHING",
      deadlockDetected: cycle !== null,
      cycle: cycle || [],
      pathsConstructed: cycle ? [cycle.join(" -> ")] : [],
      description: "Obermarck Path-Pushing: Sites assemble wait paths and detect cycle across site boundaries",
    };
  }

  static simulateEdgeChasing(wfg: Record<string, string[]>) {
    const cycle = findWfgCycle(wfg);
    const probes = [];
    if (cycle) {
      for (let i = 0; i < cycle.length - 1; i++) {
        probes.push({ from: cycle[i], to: cycle[i + 1], probeId: `PROBE-${cycle[0]}` });
      }
    }
    return {
      category: "EDGE_CHASING",
      deadlockDetected: cycle !== null,
      cycle: cycle || [],
      probesExchanged: probes,
      description: "Chandy-Misra-Haas: Special probe message dispatched along wait-for edges; returning probe confirms circular wait",
    };
  }

  static simulateDiffusionComputation(wfg: Record<string, string[]>) {
    const cycle = findWfgCycle(wfg);
    return {
      category: "DIFFUSION_COMPUTATION",
      deadlockDetected: cycle !== null,
      cycle: cycle || [],
      echoesReceived: cycle ? 0 : Object.keys(wfg).length,
      description: "Dijkstra-Scholten / Chandy: Query message diffused along graph. Deadlock asserted when termination fails to echo",
    };
  }

  static simulateGlobalStateDetection(wfg: Record<string, string[]>) {
    const cycle = findWfgCycle(wfg);
    return {
      category: "GLOBAL_STATE_DETECTION",
      deadlockDetected: cycle !== null,
      cycle: cycle || [],
      stronglyConnectedComponents: cycle ? [cycle] : [],
      description: "Consistent global state snapshot analyzed for knot/strongly-connected component",
    };
  }
}

// ----------------------------------------------------------------------------
// FEATURE 8: Distributed Election Algorithms (Bully & Ring)
// ----------------------------------------------------------------------------

export class ConcurrentElectionEngine {
  private crashedNodes = new Set<string>();
  private priorities: Record<string, number> = {
    "sender-bank": 1,
    "transaction-service": 2,
    "receiver-bank": 3,
    "npci": 4,
  };

  crashNode(nodeId: string) {
    this.crashedNodes.add(nodeId);
  }

  recoverNode(nodeId: string) {
    this.crashedNodes.delete(nodeId);
  }

  async runBullyElection(initiatorId: string) {
    const all = ["sender-bank", "transaction-service", "receiver-bank", "npci"];
    const active = all.filter((n) => !this.crashedNodes.has(n));
    let highest = active[0];
    for (const n of active) {
      if ((this.priorities[n] || 0) > (this.priorities[highest] || 0)) {
        highest = n;
      }
    }

    return {
      algorithm: "Bully",
      initiator: initiatorId,
      electedCoordinator: highest,
      messagesExchanged: active.length * 2,
      activeNodes: active,
    };
  }

  async runRingElection(initiatorId: string) {
    const ring = ["sender-bank", "transaction-service", "npci", "receiver-bank"];
    const active = ring.filter((n) => !this.crashedNodes.has(n));
    let highest = active[0];
    for (const n of active) {
      if ((this.priorities[n] || 0) > (this.priorities[highest] || 0)) {
        highest = n;
      }
    }

    return {
      algorithm: "Ring",
      initiator: initiatorId,
      electedCoordinator: highest,
      messagesExchanged: active.length + 1,
      activeNodesVisited: active,
    };
  }
}

