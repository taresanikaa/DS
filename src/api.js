// UPI Distributed Transaction Simulator - Optimised API & Shared WebSocket Multiplexer

// In this unified fullstack applet, all endpoints (/api/*, /failure/*, /services/*)
// are served on the same origin via Express.
const TXN_BASE = "";
const SENDER_BANK_BASE = "/services/sender-bank";
const NPCI_BASE = "/services/npci";
const RECEIVER_BANK_BASE = "/services/receiver-bank";
const WS_PROTO = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_HOST = typeof window !== "undefined" ? window.location.host : "localhost:3000";
const WS_URL = `${WS_PROTO}//${WS_HOST}/ws/transactions`;

async function safeJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function request(path, options, baseUrl = "") {
  let targetUrl = `${baseUrl}${path}`;
  if (targetUrl.startsWith("http://localhost:8000")) {
    targetUrl = targetUrl.replace("http://localhost:8000", "");
  } else if (targetUrl.startsWith("http://127.0.0.1:8000")) {
    targetUrl = targetUrl.replace("http://127.0.0.1:8000", "");
  }
  let res;
  try {
    res = await fetch(targetUrl, options);
  } catch {
    throw new Error(`Could not reach service at ${targetUrl || path}. Is it running?`);
  }
  const data = await safeJson(res);
  if (!res.ok) {
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return data;
}

/**
 * Single-trip atomic snapshot (replaces 7 separate HTTP calls with 1)
 */
export async function fetchSnapshot() {
  return request("/api/snapshot");
}

export async function fetchUsers() {
  const data = await request("/api/users");
  return data.users;
}

export async function initiateTransaction({ senderId, receiverId, amount, idempotencyKey, mode }) {
  return request("/api/transaction/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderId, receiverId, amount, idempotencyKey, mode }),
  });
}

export async function fetchTransactions() {
  const data = await request("/api/transactions");
  return data.transactions;
}

export async function fetchLedger() {
  return request("/api/ledger");
}

export async function fetchWebRTCStats() {
  return request("/api/websocket/stats");
}

export async function fetchWebRTCRooms() {
  return request("/api/webrtc/rooms");
}

export async function fetchStats() {
  return request("/api/stats");
}

export async function fetchWebSocketStats() {
  return request("/api/websocket/stats");
}

export async function fetchFailureStatus() {
  return request("/failure/status");
}

export async function toggleFailure(target, enable) {
  return request(`/failure/${target}/${enable ? "enable" : "disable"}`, { method: "POST" });
}

export async function resetCircuitBreakers() {
  return request("/api/circuit-breaker/reset", { method: "POST" });
}

export async function resetSystem() {
  return request("/failure/reset-all", { method: "POST" });
}

export async function checkHealth(baseUrl, name, port) {
  let targetUrl = `${baseUrl || ""}/health`;
  if (targetUrl.startsWith("http://localhost:8000")) {
    targetUrl = targetUrl.replace("http://localhost:8000", "");
  } else if (targetUrl.startsWith("http://127.0.0.1:8000")) {
    targetUrl = targetUrl.replace("http://127.0.0.1:8000", "");
  }
  try {
    const res = await fetch(targetUrl);
    if (res.ok) {
      return { service: name, port, status: "healthy" };
    }
    return { service: name, port, status: "unhealthy" };
  } catch {
    return { service: name, port, status: "offline" };
  }
}

export async function fetchAllServicesHealth() {
  const [txn, sender, npci, receiver] = await Promise.all([
    checkHealth(TXN_BASE, "Transaction Service", "8000"),
    checkHealth(SENDER_BANK_BASE, "Sender Bank Service", "8001"),
    checkHealth(NPCI_BASE, "NPCI Simulator", "8002"),
    checkHealth(RECEIVER_BANK_BASE, "Receiver Bank Service", "8003"),
  ]);
  return {
    "transaction-service": txn,
    "sender-bank": sender,
    "npci": npci,
    "receiver-bank": receiver,
  };
}

// ---------------------------------------------------------------------------
// Unit III & IV Synchronization & Web Systems API Helpers
// ---------------------------------------------------------------------------

// Unit I: gRPC & Architecture API Functions
export async function fetchUnit1Overview() {
  return request("/api/unit1/overview");
}

export async function fetchGrpcStatus() {
  return request("/api/grpc/status");
}

export async function testGrpcCall(payload) {
  return request("/api/grpc/test-call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Unit III: Retained Synchronization API Functions
export async function fetchLamportClocks() {
  return request("/api/synchronization/lamport");
}

export async function triggerLamportEvent(payload) {
  return request("/api/synchronization/lamport/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function resetLamportClocks() {
  return request("/api/synchronization/lamport/reset", { method: "POST" });
}

export async function fetchInterceptorMetrics() {
  return request("/api/interceptor/metrics");
}

export async function resetInterceptorMetrics() {
  return request("/api/interceptor/reset", { method: "POST" });
}

export async function requestMutexLock(nodeId, algorithm) {
  return request("/api/synchronization/mutex/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId, algorithm }),
  });
}

export async function releaseMutexLock(nodeId) {
  return request("/api/synchronization/mutex/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId }),
  });
}

export async function requestLKMutexLock(nodeId, clock) {
  return request("/api/synchronization/mutex/lk-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId, clock }),
  });
}

export async function releaseLKMutexLock(nodeId) {
  return request("/api/synchronization/mutex/lk-release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeId }),
  });
}

export async function runRaceExperiment(mode = "unlocked") {
  return request("/api/synchronization/race-experiment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}


// Unit II: Communication API Functions
export async function invokeRpcCall(params) {
  return request("/api/communication/rpc/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function fetchQueueStatus() {
  return request("/api/communication/queue/status");
}

export async function publishQueueMessage(params) {
  return request("/api/communication/queue/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function consumeQueueMessage(queueName, consumerId) {
  return request("/api/communication/queue/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queueName, consumerId }),
  });
}

export async function testQueueDuplicate() {
  return request("/api/communication/queue/test-duplicate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function fetchNamingServices() {
  return request("/api/communication/naming/services");
}

export async function resolveNamingService(lookupKey) {
  return request("/api/communication/naming/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lookupKey }),
  });
}

export async function triggerUncertainFault(transactionId) {
  return request("/api/communication/fault/trigger-uncertain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId }),
  });
}

export async function reconcileFault(transactionId, confirmedAtReceiver) {
  return request("/api/communication/fault/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId, confirmedAtReceiver }),
  });
}

// ---------------------------------------------------------------------------
// Phase 6: Distributed Database Consistency & Replication Experiment APIs
// ---------------------------------------------------------------------------
export async function fetchConsistencyStatus() {
  return request("/api/experiments/consistency/status");
}

export async function toggleConsistencyPartition(enabled, latencyMs = 150) {
  return request("/api/experiments/consistency/partition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, latencyMs }),
  });
}

export async function setConsistencyModel(model) {
  return request("/api/experiments/consistency/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
}

export async function writeConsistencyRecord(key, value, targetReplica) {
  return request("/api/experiments/consistency/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, targetReplica }),
  });
}

export async function reconcileConsistency(strategy = "LAST_WRITE_WINS") {
  return request("/api/experiments/consistency/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy }),
  });
}

export async function resetConsistency() {
  return request("/api/experiments/consistency/reset", {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Shared Singleton Multiplexed WebSocket Manager
// Prevents reconnect churn across route navigation & coalesces heartbeats
// ---------------------------------------------------------------------------
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 12000;
const HEARTBEAT_INTERVAL_MS = 15000;

let sharedWs = null;
let sharedStatus = "connecting";
let sharedLastSeq = 0;
let sharedAttempt = 0;
let reconnectTimer = null;
let heartbeatTimer = null;

const eventSubscribers = new Set();
const statusSubscribers = new Set();

function notifyStatus(nextStatus) {
  sharedStatus = nextStatus;
  statusSubscribers.forEach((cb) => {
    try {
      cb(sharedStatus);
    } catch {
      // ignore subscriber errors
    }
  });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
      try {
        sharedWs.send(JSON.stringify({ action: "ping" }));
      } catch {
        // ignore write error
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function ensureSocketOpen() {
  if (
    sharedWs &&
    (sharedWs.readyState === WebSocket.OPEN || sharedWs.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  notifyStatus(sharedAttempt === 0 ? "connecting" : "reconnecting");
  const targetUrl =
    sharedLastSeq > 0 ? `${WS_URL}?lastSequence=${sharedLastSeq}` : WS_URL;
  sharedWs = new WebSocket(targetUrl);

  sharedWs.onopen = () => {
    sharedAttempt = 0;
    notifyStatus("connected");
    startHeartbeat();
  };

  sharedWs.onmessage = (msg) => {
    try {
      const payload = JSON.parse(msg.data);
      if (payload.sequence && payload.sequence > sharedLastSeq) {
        sharedLastSeq = payload.sequence;
      }
      eventSubscribers.forEach((cb) => {
        try {
          cb(payload);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore malformed frames
    }
  };

  sharedWs.onclose = () => {
    stopHeartbeat();
    sharedWs = null;
    if (eventSubscribers.size === 0 && statusSubscribers.size === 0) {
      notifyStatus("disconnected");
      return;
    }
    notifyStatus("reconnecting");
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** sharedAttempt, RECONNECT_MAX_DELAY_MS);
    sharedAttempt += 1;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(ensureSocketOpen, delay);
  };

  sharedWs.onerror = () => {
    // onclose handles retry
  };
}

export function connectTransactionSocket(onEvent, onStatusChange) {
  if (onEvent) eventSubscribers.add(onEvent);
  if (onStatusChange) {
    statusSubscribers.add(onStatusChange);
    onStatusChange(sharedStatus);
  }

  ensureSocketOpen();

  return {
    close() {
      if (onEvent) eventSubscribers.delete(onEvent);
      if (onStatusChange) statusSubscribers.delete(onStatusChange);
    },
    requestReplay(seq) {
      if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
        sharedWs.send(
          JSON.stringify({ action: "replay", lastSequence: seq || sharedLastSeq })
        );
      }
    },
    sendPing() {
      if (sharedWs && sharedWs.readyState === WebSocket.OPEN) {
        sharedWs.send(JSON.stringify({ action: "ping" }));
      }
    },
  };
}
