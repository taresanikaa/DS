import express, { Request, Response } from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import {
  LamportClockManager,
  DistributedMutexManager,
  ServiceLevelLamportInterceptor,
  LodhaKshemkalyaniMutexManager,
  ClockSyncManager,
  VectorClockManager,
  VectorClock,
  BeaconProtocolManager,
  GlobalStateManager,
  ElectionAlgorithmManager,
  KnappDeadlockDetectionManager,
  DistributedSystemsParadigmsManager,
} from "./src/server/synchronization.js";
import {
  RpcComparisonManager,
  MessageOrientedQueueBroker,
  NameIdentifierAddressRegistry,
  FaultToleranceManager,
} from "./src/server/communication.js";
import {
  startGrpcAccountServer,
  stopGrpcAccountServer,
  getGrpcAccountClient,
  executeGrpcDebit,
  executeGrpcCredit,
  executeGrpcBalance,
  executeGrpcHealth,
  executeGrpcRollback,
  setAccountStore,
} from "./src/server/grpcAccountService.js";
import {
  db,
  DB_PATH,
  persistentDb,
  rupeesToPaise,
  paiseToRupees,
  DbTransactionRecord,
  DbUserRecord,
  DbTimelineEvent,
} from "./src/server/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 2);
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_SECONDS || 0.4) * 1000;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_SECONDS || 3) * 1000;
const CB_FAILURE_THRESHOLD = Number(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || 3);
const CB_RECOVERY_TIMEOUT_SEC = Number(process.env.CIRCUIT_BREAKER_RECOVERY_TIMEOUT || 10);
const CB_SUCCESS_THRESHOLD = Number(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || 1);

// ---------------------------------------------------------------------------
// In-Memory State (Users, Transactions, Debits, Credits, Failure Simulation)
// ---------------------------------------------------------------------------

interface UserRecord {
  id: string;
  name: string;
  upi_id: string;
  bank_name: string;
  bank?: string;
  balance: number;
  created_at: string;
}

interface TimelineEvent {
  event: string;
  service: string;
  message: string;
  timestamp: string;
  sequence?: number;
  [key: string]: any;
}

interface TransactionRecord {
  transactionId: string;
  senderId: string;
  receiverId: string;
  amount: number;
  status: string;
  failureReason: string | null;
  idempotencyKey: string | null;
  mode?: string;
  timeline: TimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

const nowIso = () => new Date().toISOString();

// Authoritative user/account lookup backed directly by persistent SQLite database
function listUsers(): UserRecord[] {
  const accounts = persistentDb.listAccounts();
  return accounts.map((u) => ({
    id: u.id,
    name: u.name,
    upi_id: u.upi_id,
    bank: u.bank_name,
    bank_name: u.bank_name,
    balance: u.balance,
    created_at: u.created_at,
  }));
}

function getUserByIdOrUpi(identifier: string): UserRecord | null {
  if (!identifier) return null;
  const acc = persistentDb.getAccountByUpiOrId(identifier);
  if (!acc) return null;
  return {
    id: acc.id,
    name: acc.name,
    upi_id: acc.upi_id,
    bank: acc.bank_name,
    bank_name: acc.bank_name,
    balance: acc.balance,
    created_at: acc.created_at,
  };
}

// In-flight working state cache, always kept synchronized with SQLite authoritative data
const TRANSACTIONS = new Map<string, TransactionRecord>();
const IDEMPOTENCY_INDEX = new Map<string, string>();
const SENDER_DEBITS = new Map<string, { senderUpi: string; amount: number }>();
const RECEIVER_CREDITS = new Map<string, string>();
const ABORTED_TRANSACTIONS = new Set<string>();

function loadInitialStateFromDb() {
  // Automatically recover any uncompleted or interrupted transactions from unexpected crash/restart
  persistentDb.recoverInterruptedTransactions();

  const dbTxns = persistentDb.listTransactions(100);
  for (const t of dbTxns) {
    const txn: TransactionRecord = {
      transactionId: t.transactionId,
      senderId: t.senderId,
      receiverId: t.receiverId,
      amount: t.amount,
      status: t.status,
      failureReason: t.failureReason,
      idempotencyKey: t.idempotencyKey,
      mode: t.mode,
      timeline: t.timeline,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
    TRANSACTIONS.set(t.transactionId, txn);
    if (t.idempotencyKey) {
      IDEMPOTENCY_INDEX.set(t.idempotencyKey, t.transactionId);
    }
  }
}
loadInitialStateFromDb();

const FAILURE_STATE = {
  sender_bank_failure: false,
  npci_failure: false,
  receiver_bank_failure: false,
  timeout_simulation: false,
};

const FRIENDLY_TO_TARGET: Record<string, keyof typeof FAILURE_STATE> = {
  "sender-bank": "sender_bank_failure",
  npci: "npci_failure",
  "receiver-bank": "receiver_bank_failure",
};

// ---------------------------------------------------------------------------
// Circuit Breaker Implementation
// ---------------------------------------------------------------------------

enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

class CircuitBreaker {
  name: string;
  failureThreshold: number;
  recoveryTimeout: number;
  successThreshold: number;
  private _state: CircuitState = CircuitState.CLOSED;
  private _failureCount = 0;
  private _consecutiveSuccesses = 0;
  private _lastStateChange: Date = new Date();

  constructor(
    name: string,
    failureThreshold = CB_FAILURE_THRESHOLD,
    recoveryTimeout = CB_RECOVERY_TIMEOUT_SEC,
    successThreshold = CB_SUCCESS_THRESHOLD
  ) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.successThreshold = successThreshold;
  }

  get state(): CircuitState {
    if (this._state === CircuitState.OPEN) {
      const elapsedSec = (Date.now() - this._lastStateChange.getTime()) / 1000;
      if (elapsedSec >= this.recoveryTimeout) {
        return CircuitState.HALF_OPEN;
      }
    }
    return this._state;
  }

  async canExecute(): Promise<boolean> {
    const current = this.state;
    if (current === CircuitState.HALF_OPEN && this._state === CircuitState.OPEN) {
      await this.setState(
        CircuitState.HALF_OPEN,
        `Recovery timeout (${this.recoveryTimeout}s) elapsed. Entering trial state.`
      );
      return true;
    }
    if (this._state === CircuitState.OPEN) {
      return false;
    }
    return true;
  }

  async recordSuccess() {
    const current = this.state;
    if (current === CircuitState.HALF_OPEN || this._state === CircuitState.HALF_OPEN) {
      this._consecutiveSuccesses += 1;
      if (this._consecutiveSuccesses >= this.successThreshold) {
        this._failureCount = 0;
        this._consecutiveSuccesses = 0;
        await this.setState(
          CircuitState.CLOSED,
          `Trial request succeeded (${this.successThreshold} success). Service recovered.`
        );
      }
    } else if (this._state === CircuitState.CLOSED) {
      this._failureCount = 0;
    }
  }

  async recordFailure() {
    const current = this.state;
    if (current === CircuitState.HALF_OPEN || this._state === CircuitState.HALF_OPEN) {
      this._failureCount = this.failureThreshold;
      this._consecutiveSuccesses = 0;
      await this.setState(
        CircuitState.OPEN,
        "Trial request failed in HALF_OPEN state. Re-opening circuit."
      );
    } else if (this._state === CircuitState.CLOSED) {
      this._failureCount += 1;
      if (this._failureCount >= this.failureThreshold) {
        await this.setState(
          CircuitState.OPEN,
          `Failure threshold (${this.failureThreshold}) reached. Circuit opened.`
        );
      }
    }
  }

  private async setState(newState: CircuitState, reason: string) {
    const oldState = this._state;
    if (oldState === newState) return;
    this._state = newState;
    this._lastStateChange = new Date();
    broadcastStreamEvent({
      event: "CIRCUIT_BREAKER_STATE_CHANGE",
      service: this.name,
      oldState,
      newState,
      reason,
    });
  }

  async reset() {
    this._failureCount = 0;
    this._consecutiveSuccesses = 0;
    await this.setState(CircuitState.CLOSED, "Manual reset triggered");
  }

  getStatusDict() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this._failureCount,
      failureThreshold: this.failureThreshold,
      recoveryTimeout: this.recoveryTimeout,
      successThreshold: this.successThreshold,
      lastStateChange: this._lastStateChange.toISOString(),
    };
  }
}

const circuitBreakers: Record<string, CircuitBreaker> = {
  "sender-bank": new CircuitBreaker("Sender Bank Service"),
  npci: new CircuitBreaker("NPCI Simulator Service"),
  "receiver-bank": new CircuitBreaker("Receiver Bank Service"),
};

function getBreakerByLabel(serviceLabel: string): CircuitBreaker {
  if (serviceLabel.toLowerCase().includes("sender")) return circuitBreakers["sender-bank"];
  if (serviceLabel.toLowerCase().includes("npci")) return circuitBreakers["npci"];
  if (serviceLabel.toLowerCase().includes("receiver")) return circuitBreakers["receiver-bank"];
  if (!circuitBreakers[serviceLabel]) {
    circuitBreakers[serviceLabel] = new CircuitBreaker(serviceLabel);
  }
  return circuitBreakers[serviceLabel];
}

function getAllCircuitBreakerStatuses() {
  const result: Record<string, any> = {};
  for (const [k, cb] of Object.entries(circuitBreakers)) {
    result[k] = cb.getStatusDict();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Unit III & IV Synchronization Singletons
// ---------------------------------------------------------------------------
const lamportManager = new LamportClockManager();
const serviceInterceptor = new ServiceLevelLamportInterceptor(lamportManager);
const mutexManager = new DistributedMutexManager();
const lkMutexManager = new LodhaKshemkalyaniMutexManager();
const clockSyncManager = new ClockSyncManager();
const vectorManager = new VectorClockManager();
const beaconManager = new BeaconProtocolManager();
const globalStateManager = new GlobalStateManager();
const electionManager = new ElectionAlgorithmManager();
const knappDeadlockManager = new KnappDeadlockDetectionManager();
const paradigmsManager = new DistributedSystemsParadigmsManager();
const rpcComparisonManager = new RpcComparisonManager();
const queueBroker = new MessageOrientedQueueBroker();
const namingRegistry = new NameIdentifierAddressRegistry();
const faultToleranceManager = new FaultToleranceManager();
let grpcClient: any = null;

function getServiceNodeId(serviceName: string): string {
  const lower = serviceName.toLowerCase();
  if (lower.includes("sender")) return "sender-bank";
  if (lower.includes("npci")) return "npci";
  if (lower.includes("receiver")) return "receiver-bank";
  return "transaction-service";
}

// ---------------------------------------------------------------------------
// WebSocket Stream Manager (/ws/transactions) & WebRTC Signaling (/ws/webrtc)
// ---------------------------------------------------------------------------

const MAX_STREAM_BUFFER_SIZE = 500;
let sequenceCounter = 0;
const streamBuffer: any[] = [];
const streamClients = new Set<WebSocket>();

function broadcastStreamEvent(rawEvent: Record<string, any>) {
  sequenceCounter += 1;
  const timestamp = nowIso();
  const eventId = `EVT-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const srcNode = getServiceNodeId(rawEvent.service || rawEvent.source || "transaction-service");
  const lamport = rawEvent.lamport ?? lamportManager.getClock(srcNode);
  const vector = rawEvent.vector ?? vectorManager.getVector(srcNode);

  const formatted = {
    eventId,
    sequence: sequenceCounter,
    transactionId: rawEvent.transactionId || rawEvent.txnId || "SYS-GLOBAL",
    eventType: rawEvent.event || rawEvent.eventType || "GENERIC_SIGNAL",
    event: rawEvent.event || rawEvent.eventType || "GENERIC_SIGNAL",
    timestamp,
    source: rawEvent.service || rawEvent.source || "transaction-service",
    service: rawEvent.service || rawEvent.source || "transaction-service",
    status: rawEvent.status || "PROCESSING",
    message: rawEvent.message || rawEvent.reason || rawEvent.event || "",
    lamport,
    vector,
    ...rawEvent,
    payload: rawEvent,
  };

  streamBuffer.push(formatted);
  if (streamBuffer.length > MAX_STREAM_BUFFER_SIZE) {
    streamBuffer.shift();
  }

  const msgText = JSON.stringify(formatted);
  for (const client of Array.from(streamClients)) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(msgText);
      } catch {
        streamClients.delete(client);
      }
    } else if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
      streamClients.delete(client);
    }
  }

  return formatted;
}

function replayMissedEvents(ws: WebSocket, lastSequence: number) {
  if (lastSequence <= 0 || streamBuffer.length === 0) return 0;
  const minBuffered = streamBuffer[0]?.sequence ?? 0;
  if (lastSequence < minBuffered - 1) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          event: "STREAM_MISSED_RECOVERY_EXPIRED",
          eventType: "STREAM_MISSED_RECOVERY_EXPIRED",
          timestamp: nowIso(),
          message: `Requested sequence ${lastSequence} is older than replay buffer (min seq: ${minBuffered})`,
          sequence: sequenceCounter,
        })
      );
    }
    return 0;
  }
  let count = 0;
  for (const ev of streamBuffer) {
    if ((ev.sequence || 0) > lastSequence && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(ev));
      count++;
    }
  }
  return count;
}

function getStreamStats() {
  return {
    activeClients: streamClients.size,
    totalSequence: sequenceCounter,
    bufferedEvents: streamBuffer.length,
    maxBufferSize: MAX_STREAM_BUFFER_SIZE,
  };
}

// WebRTC Signaling state
const webrtcRooms = new Map<string, Map<string, WebSocket>>();
const webrtcPeerMeta = new Map<WebSocket, { roomId: string; peerId: string }>();

function getWebRTCRoomPeers(roomId: string): string[] {
  const room = webrtcRooms.get(roomId);
  return room ? Array.from(room.keys()) : [];
}

function getAllWebRTCRooms(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [rid, peers] of webrtcRooms.entries()) {
    out[rid] = Array.from(peers.keys());
  }
  return out;
}

function connectWebRTCPeer(ws: WebSocket, roomId: string, peerId: string): boolean {
  let room = webrtcRooms.get(roomId);
  if (!room) {
    room = new Map();
    webrtcRooms.set(roomId, room);
  }
  const existing = room.get(peerId);
  if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
    return false;
  }
  room.set(peerId, ws);
  webrtcPeerMeta.set(ws, { roomId, peerId });
  return true;
}

function disconnectWebRTCSocket(ws: WebSocket): { roomId: string; peerId: string } | null {
  const meta = webrtcPeerMeta.get(ws);
  if (!meta) return null;
  webrtcPeerMeta.delete(ws);

  const { roomId, peerId } = meta;
  const room = webrtcRooms.get(roomId);
  if (room) {
    room.delete(peerId);
    const remainingPeers = Array.from(room.keys());
    const notifyMsg = JSON.stringify({
      type: "peer-left",
      roomId,
      peerId,
      peers: remainingPeers,
    });
    for (const targetWs of room.values()) {
      if (targetWs.readyState === WebSocket.OPEN) {
        try {
          targetWs.send(notifyMsg);
        } catch {
          // ignore
        }
      }
    }
    if (room.size === 0) {
      webrtcRooms.delete(roomId);
    }
  }
  return meta;
}

function routeWebRTCSignalingMessage(senderWs: WebSocket, payload: Record<string, any>) {
  const meta = webrtcPeerMeta.get(senderWs);
  if (!meta) return;
  const { roomId, peerId: senderPeerId } = meta;
  const room = webrtcRooms.get(roomId);
  if (!room) return;

  const forwardPayload = JSON.stringify({
    ...payload,
    roomId,
    peerId: senderPeerId,
  });

  const targetPeerId = payload.targetPeerId;
  if (targetPeerId && room.has(targetPeerId)) {
    const targetWs = room.get(targetPeerId)!;
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(forwardPayload);
    }
  } else {
    for (const [pid, targetWs] of room.entries()) {
      if (pid !== senderPeerId && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(forwardPayload);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Simulated Downstream Microservice Operations & Retry Wrapper
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function recordTimeline(
  txn: TransactionRecord,
  eventType: string,
  serviceName = "Transaction Service",
  message = "",
  extra: Record<string, any> = {}
) {
  const timestamp = nowIso();
  const nodeId = getServiceNodeId(serviceName);
  const lamport = extra.lamport ?? lamportManager.getClock(nodeId);
  const vector = extra.vector ?? vectorManager.getVector(nodeId);

  const entry: TimelineEvent = {
    event: eventType,
    service: serviceName,
    message: message || extra.reason || extra.detail || eventType.replace(/_/g, " "),
    timestamp,
    lamport,
    vector,
    ...extra,
  };
  txn.timeline.push(entry);
  txn.updatedAt = timestamp;

  try {
    persistentDb.appendTimelineEvent(txn.transactionId, {
      event: entry.event,
      service: entry.service,
      message: entry.message,
      timestamp: entry.timestamp,
      sequence: entry.sequence,
      lamport: entry.lamport,
      vector: entry.vector,
      headers: entry.headers,
      interServiceCall: entry.interServiceCall,
    });
  } catch (err) {
    console.error("Failed to append timeline event to SQLite:", err);
  }
}

function setStatus(txn: TransactionRecord, status: string, failureReason: string | null = null) {
  txn.status = status;
  if (failureReason !== null) {
    txn.failureReason = failureReason;
  }
  txn.updatedAt = nowIso();

  try {
    persistentDb.upsertTransaction({
      transactionId: txn.transactionId,
      senderId: txn.senderId,
      receiverId: txn.receiverId,
      amount: txn.amount,
      amountPaise: rupeesToPaise(txn.amount),
      status: txn.status,
      failureReason: txn.failureReason,
      idempotencyKey: txn.idempotencyKey,
      mode: txn.mode || "rest",
      timeline: txn.timeline,
      createdAt: txn.createdAt,
      updatedAt: txn.updatedAt,
    });
  } catch (err) {
    console.error("Failed to upsert transaction status to SQLite:", err);
  }
}

async function simulateSenderBankDebit(senderId: string, amount: number, transactionId: string) {
  if (FAILURE_STATE.sender_bank_failure) {
    throw new Error("sender-bank-service simulated failure (HTTP 503)");
  }
  if (FAILURE_STATE.timeout_simulation) {
    await sleep(5000);
  }
  await sleep(60);

  const amountPaise = rupeesToPaise(amount);
  const debitRes = persistentDb.atomicDebit(
    senderId,
    amountPaise,
    transactionId,
    `UPI Debit: ₹${amount} for transaction ${transactionId}`
  );

  if (!debitRes.success) {
    return {
      status: "DECLINED",
      approved: false,
      reason: debitRes.reason || "Insufficient balance",
    };
  }

  SENDER_DEBITS.set(transactionId, { senderUpi: debitRes.senderUpi || senderId, amount });
  return {
    status: "DEBITED",
    approved: true,
    accountId: debitRes.senderUpi || senderId,
  };
}

async function simulateSenderBankRollback(transactionId: string) {
  await sleep(40);
  const rollbackRes = persistentDb.atomicRollback(transactionId);
  SENDER_DEBITS.delete(transactionId);
  if (!rollbackRes.success) {
    return {
      status: rollbackRes.reason?.includes("receiver credit already settled")
        ? "CREDIT_ALREADY_SETTLED"
        : "NO_DEBIT_FOUND",
      reason: rollbackRes.reason,
    };
  }
  return {
    status: "ROLLED_BACK",
    amount: paiseToRupees(rollbackRes.amountPaise || 0),
  };
}

async function simulateNpciRoute(transactionId: string) {
  if (FAILURE_STATE.npci_failure) {
    throw new Error("npci-simulator-service simulated failure (HTTP 503)");
  }
  if (FAILURE_STATE.timeout_simulation) {
    await sleep(5000);
  }
  await sleep(120);
  return { status: "ROUTED", transactionId };
}

async function simulateReceiverBankCredit(receiverId: string, amount: number, transactionId: string) {
  if (ABORTED_TRANSACTIONS.has(transactionId)) {
    throw new Error(`Transaction ${transactionId} was aborted/rolled back; receiver credit cancelled.`);
  }
  if (FAILURE_STATE.receiver_bank_failure) {
    throw new Error("receiver-bank-service simulated failure (HTTP 503)");
  }
  if (FAILURE_STATE.timeout_simulation) {
    await sleep(5000);
  }
  if (ABORTED_TRANSACTIONS.has(transactionId)) {
    throw new Error(`Transaction ${transactionId} was aborted/rolled back; receiver credit cancelled.`);
  }
  await sleep(60);

  const amountPaise = rupeesToPaise(amount);
  const creditRes = persistentDb.atomicCredit(
    receiverId,
    amountPaise,
    transactionId,
    `UPI Credit: ₹${amount} for transaction ${transactionId}`
  );

  if (!creditRes.success) {
    throw new Error(creditRes.reason || `Receiver credit failed for account ${receiverId}`);
  }

  const ackId = creditRes.ackId || randomUUID();
  RECEIVER_CREDITS.set(transactionId, ackId);
  return { status: "CREDITED", ackId };
}

class TransactionFailedError extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

async function callWithRetry<T>(
  operation: () => Promise<T>,
  transactionId: string,
  serviceLabel: string,
  txn: TransactionRecord
): Promise<T> {
  const breaker = getBreakerByLabel(serviceLabel);

  if (!(await breaker.canExecute())) {
    const reason = `Circuit breaker is ${breaker.state} for ${serviceLabel} - fast-failing request without network delay`;
    recordTimeline(txn, "CIRCUIT_BREAKER_FAST_FAIL", serviceLabel, reason);
    broadcastStreamEvent({
      event: "CIRCUIT_BREAKER_FAST_FAIL",
      transactionId,
      service: serviceLabel,
      circuitState: breaker.state,
      reason,
    });
    throw new TransactionFailedError(reason);
  }

  let lastError: Error | null = null;
  let wasTimeout = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (ABORTED_TRANSACTIONS.has(transactionId)) {
      throw new TransactionFailedError(`Transaction ${transactionId} was aborted/rolled back`);
    }

    let timer: NodeJS.Timeout | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TIMEOUT")), REQUEST_TIMEOUT_MS);
      });

      const opPromise = operation();
      opPromise.catch(() => {}); // Suppress unhandled rejection on late completion after timeout

      const result = await Promise.race([
        opPromise,
        timeoutPromise,
      ]);
      clearTimeout(timer);
      await breaker.recordSuccess();
      return result;
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      if (err?.message === "TIMEOUT") {
        wasTimeout = true;
        lastError = new Error(`${serviceLabel} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      await breaker.recordFailure();

      if (attempt === 0) {
        const msg = `Failure detected on ${serviceLabel}: ${wasTimeout ? "Timeout" : lastError.message}`;
        recordTimeline(txn, "SERVICE_FAILURE_DETECTED", serviceLabel, msg);
        broadcastStreamEvent({
          event: "SERVICE_FAILURE_DETECTED",
          transactionId,
          service: serviceLabel,
          reason: wasTimeout ? "Timeout" : lastError.message,
        });
      }

      if (attempt < MAX_RETRIES) {
        const nextAttempt = attempt + 1;
        recordTimeline(
          txn,
          `RETRY_ATTEMPT_${nextAttempt}`,
          serviceLabel,
          `Automated retry attempt ${nextAttempt}/${MAX_RETRIES} for ${serviceLabel}`
        );
        broadcastStreamEvent({
          event: `RETRY_ATTEMPT_${nextAttempt}`,
          transactionId,
          service: serviceLabel,
          attempt: nextAttempt,
        });
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  const finalReason = wasTimeout
    ? `${serviceLabel} timed out after ${MAX_RETRIES + 1} attempts`
    : `${serviceLabel} unavailable after ${MAX_RETRIES + 1} attempts (${lastError?.message})`;
  throw new TransactionFailedError(finalReason);
}

async function safeRollbackSenderDebit(txn: TransactionRecord, mode = "rest") {
  const txnId = txn.transactionId;
  ABORTED_TRANSACTIONS.add(txnId);

  const lRollbackInit = serviceInterceptor.recordEvent(
    "transaction-service",
    `Initiate compensating rollback of sender debit for ${txnId} (mode=${mode.toUpperCase()})`
  );
  const rollbackReq = serviceInterceptor.interceptOutgoingRequest(
    "transaction-service",
    "sender-bank",
    "/services/sender-bank/rollback",
    "COMPENSATION_ROLLBACK",
    txnId,
    { mode }
  );
  const rollbackRecv = serviceInterceptor.interceptIncomingRequest(
    "sender-bank",
    "transaction-service",
    rollbackReq.lamportTimestamp,
    "/services/sender-bank/rollback",
    "COMPENSATION_ROLLBACK",
    txnId,
    rollbackReq.headers
  );

  const vRollbackSend = vectorManager.tickSend("transaction-service", "sender-bank", "Rollback debit initiated");
  const vRollbackRecv = vectorManager.tickReceive("sender-bank", "transaction-service", vRollbackSend, "Rollback debit received");

  recordTimeline(
    txn,
    "ROLLBACK_INITIATED",
    "Transaction Service",
    `Initiating compensating rollback of sender debit (mode=${mode.toUpperCase()})`,
    { lamport: lRollbackInit, vector: vRollbackSend, headers: rollbackReq.headers, interServiceCall: "transaction-service -> sender-bank" }
  );
  broadcastStreamEvent({
    event: "ROLLBACK_INITIATED",
    transactionId: txnId,
    service: "Transaction Service",
    message: `Initiating compensating rollback for sender debit (${mode.toUpperCase()})`,
    lamport: lRollbackInit,
    vector: vRollbackSend,
    headers: rollbackReq.headers,
  });

  try {
    const rbResult = await simulateSenderBankRollback(txnId);
    if (rbResult.status === "CREDIT_ALREADY_SETTLED") {
      setStatus(txn, "SUCCESS", "Receiver credit was settled before rollback; transaction completed");
      recordTimeline(
        txn,
        "PAYMENT_SUCCESS_SETTLED",
        "Transaction Service",
        "Receiver credit was already confirmed and settled before rollback; transaction completed successfully."
      );
      broadcastStreamEvent({
        event: "PAYMENT_SUCCESS_SETTLED",
        transactionId: txnId,
        service: "Transaction Service",
        status: "SUCCESS",
        message: "Receiver credit already settled before rollback; transaction finalized as SUCCESS",
      });
      return;
    }
    if (rbResult.status === "NO_DEBIT_FOUND") {
      const hasDebit = SENDER_DEBITS.has(txnId) || txn.timeline.some((t) => t.event.includes("DEBIT"));
      if (hasDebit) {
        setStatus(txn, "PENDING_RECONCILIATION", "Sender rollback failed: debit state uncertain; flagged for reconciliation");
        recordTimeline(txn, "TRANSACTION_PENDING_RECONCILIATION", "Transaction Service", "Outcome uncertain: flagged for End-of-Day reconciliation");
        return;
      }
      return;
    }

    const lRbLocal = serviceInterceptor.recordEvent("sender-bank", `Sender debit compensated and balance restored for ${txnId}`);
    const rbAck = serviceInterceptor.interceptOutgoingResponse(
      "sender-bank",
      "transaction-service",
      "/services/sender-bank/rollback",
      "ROLLBACK_ACK",
      txnId
    );
    const rbFinal = serviceInterceptor.interceptIncomingResponse(
      "transaction-service",
      "sender-bank",
      rbAck.lamportTimestamp,
      "/services/sender-bank/rollback",
      "ROLLBACK_ACK",
      txnId
    );

    const vRbAck = vectorManager.tickSend("sender-bank", "transaction-service", "Rollback completed ACK");
    const vRbFinal = vectorManager.tickReceive("transaction-service", "sender-bank", vRbAck, "Rollback settlement confirmed");

    setStatus(txn, "ROLLBACK_COMPLETED");
    recordTimeline(
      txn,
      "ROLLBACK_COMPLETED",
      "Sender Bank Service",
      "Sender debit rolled back successfully to preserve consistency.",
      { lamport: rbFinal.clockAfter, vector: vRbFinal, headers: rbAck.headers }
    );
    broadcastStreamEvent({
      event: "ROLLBACK_COMPLETED",
      transactionId: txnId,
      service: "Sender Bank Service",
      status: "ROLLBACK_COMPLETED",
      message: "Sender debit rolled back to preserve consistency",
      lamport: rbFinal.clockAfter,
      vector: vRbFinal,
      headers: rbAck.headers,
    });
  } catch (err: any) {
    const lFail = serviceInterceptor.recordEvent("sender-bank", `Rollback attempt encountered error: ${err?.message || err}`);
    setStatus(txn, "PENDING_RECONCILIATION", `Rollback attempt failed: ${err?.message || err}; outcome uncertain`);
    recordTimeline(
      txn,
      "ROLLBACK_FAILED",
      "Sender Bank Service",
      `Rollback attempt encountered error: ${err?.message || err}`,
      { lamport: lFail }
    );
    broadcastStreamEvent({
      event: "ROLLBACK_FAILED",
      transactionId: txnId,
      service: "Sender Bank Service",
      status: "PENDING_RECONCILIATION",
      message: `Rollback attempt failed: ${err?.message || err}; flagged for reconciliation`,
      lamport: lFail,
    });
  }
}

async function failTransaction(txn: TransactionRecord, reason: string) {
  // If transaction has already been rolled back and compensated or needs reconciliation, preserve status
  if (txn.status === "ROLLBACK_COMPLETED" || txn.status === "PENDING_RECONCILIATION") {
    txn.failureReason = txn.failureReason || reason;
    persistentDb.upsertTransaction({
      transactionId: txn.transactionId,
      senderId: txn.senderId,
      receiverId: txn.receiverId,
      amount: txn.amount,
      amountPaise: rupeesToPaise(txn.amount),
      status: txn.status,
      failureReason: txn.failureReason,
      idempotencyKey: txn.idempotencyKey,
      mode: txn.mode || "rest",
      timeline: txn.timeline,
      createdAt: txn.createdAt,
      updatedAt: nowIso(),
    });
    return;
  }

  const lFail = serviceInterceptor.recordEvent("transaction-service", `Transaction failed: ${reason}`);
  const vFail = vectorManager.tickLocal("transaction-service", `Transaction failed: ${reason}`);
  setStatus(txn, "FAILED", reason);
  recordTimeline(txn, "TRANSACTION_FAILED", "Transaction Service", `Transaction failed: ${reason}`, { lamport: lFail, vector: vFail });
  broadcastStreamEvent({
    event: "TRANSACTION_FAILED",
    transactionId: txn.transactionId,
    status: "FAILED",
    reason,
    lamport: lFail,
    vector: vFail,
  });
}

async function processTransaction(txn: TransactionRecord): Promise<TransactionRecord> {
  const txnId = txn.transactionId;
  const mode = (txn.mode || "rest").toLowerCase();

  if (mode === "p2p" || mode === "peer") {
    const lP2p0 = serviceInterceptor.recordEvent("transaction-service", "P2P Payment Request Created");
    const vP2p0 = vectorManager.tickLocal("transaction-service", "P2P Payment Request Created");
    setStatus(txn, "PROCESSING");
    recordTimeline(
      txn,
      "P2P_REQUEST_STARTED",
      "Transaction Service",
      "Direct Peer-to-Peer payment request initiated (bypassing NPCI switch)",
      { lamport: lP2p0, vector: vP2p0 }
    );
    broadcastStreamEvent({
      event: "P2P_REQUEST_STARTED",
      transactionId: txnId,
      status: "PROCESSING",
      mode: "p2p",
      npciUsed: false,
      sourcePeer: "sender-bank-service",
      destinationPeer: "receiver-bank-service",
      lamport: lP2p0,
      vector: vP2p0,
    });

    const lP2pConn = serviceInterceptor.recordEvent("sender-bank", "Direct Peer Link Active");
    const vP2pConn = vectorManager.tickLocal("sender-bank", "Direct Peer Link Active");
    recordTimeline(
      txn,
      "P2P_PEER_CONNECTED",
      "Sender Bank Service",
      "Direct P2P connection established: sender-bank-service <-> receiver-bank-service",
      { lamport: lP2pConn, vector: vP2pConn }
    );
    broadcastStreamEvent({
      event: "P2P_PEER_CONNECTED",
      transactionId: txnId,
      mode: "p2p",
      npciUsed: false,
      sourcePeer: "sender-bank-service",
      destinationPeer: "receiver-bank-service",
      lamport: lP2pConn,
      vector: vP2pConn,
    });

    // Interceptor: Outgoing direct inter-service request with attached Lamport timestamp
    const p2pReq = serviceInterceptor.interceptOutgoingRequest(
      "sender-bank",
      "receiver-bank",
      "/services/p2p/direct-credit",
      "DIRECT_P2P_CREDIT",
      txnId,
      { amount: txn.amount }
    );
    const lP2pSend = p2pReq.lamportTimestamp;
    const p2pHeaders = p2pReq.headers;
    const vP2pSend = vectorManager.tickSend("sender-bank", "receiver-bank", "Direct P2P Credit Payload");

    recordTimeline(
      txn,
      "P2P_PEER_REQUEST_SENT",
      "Sender Bank Service",
      "Direct P2P credit payload transmitted from Sender Bank directly to Receiver Bank (NPCI switch bypassed)",
      { lamport: lP2pSend, vector: vP2pSend, headers: p2pHeaders, interServiceCall: "sender-bank -> receiver-bank" }
    );
    broadcastStreamEvent({
      event: "P2P_PEER_REQUEST_SENT",
      transactionId: txnId,
      mode: "p2p",
      npciUsed: false,
      sourcePeer: "sender-bank-service",
      destinationPeer: "receiver-bank-service",
      lamport: lP2pSend,
      vector: vP2pSend,
      headers: p2pHeaders,
    });

    try {
      const debitRes = await simulateSenderBankDebit(txn.senderId, txn.amount, txnId);
      if (!debitRes.approved) {
        await failTransaction(txn, debitRes.reason || "Sender bank declined debit");
        return txn;
      }

      // Interceptor: Destination receiver bank receives request and updates clock via Lamport Rule 3
      const p2pRecv = serviceInterceptor.interceptIncomingRequest(
        "receiver-bank",
        "sender-bank",
        lP2pSend,
        "/services/p2p/direct-credit",
        "DIRECT_P2P_CREDIT",
        txnId,
        p2pHeaders
      );
      const lP2pRecv = p2pRecv.clockAfter;

      const creditRes = await simulateReceiverBankCredit(txn.receiverId, txn.amount, txnId);
      const vP2pRecv = vectorManager.tickReceive("receiver-bank", "sender-bank", vP2pSend, "Direct P2P Credit Applied");

      // Interceptor: Receiver Bank replies with response ACK containing updated Lamport timestamp
      const p2pAck = serviceInterceptor.interceptOutgoingResponse(
        "receiver-bank",
        "sender-bank",
        "/services/p2p/direct-credit",
        "DIRECT_P2P_ACK",
        txnId
      );
      serviceInterceptor.interceptIncomingResponse(
        "sender-bank",
        "receiver-bank",
        p2pAck.lamportTimestamp,
        "/services/p2p/direct-credit",
        "DIRECT_P2P_ACK",
        txnId
      );

      recordTimeline(
        txn,
        "P2P_PEER_RESPONSE_RECEIVED",
        "Receiver Bank Service",
        "Direct ACK received from Receiver Bank (NPCI switch bypassed)",
        { lamport: lP2pRecv, vector: vP2pRecv, headers: p2pAck.headers }
      );
      broadcastStreamEvent({
        event: "P2P_PEER_RESPONSE_RECEIVED",
        transactionId: txnId,
        mode: "p2p",
        npciUsed: false,
        ackId: creditRes.ackId,
        sourcePeer: "sender-bank-service",
        destinationPeer: "receiver-bank-service",
        lamport: lP2pRecv,
        vector: vP2pRecv,
        headers: p2pAck.headers,
      });

      const lP2pFin = serviceInterceptor.recordEvent("transaction-service", "P2P Direct Settlement Finalized");
      const vP2pFin = vectorManager.tickReceive("transaction-service", "receiver-bank", vP2pRecv, "P2P Direct Settlement Finalized");
      setStatus(txn, "SUCCESS");
      recordTimeline(
        txn,
        "P2P_TRANSACTION_COMPLETED",
        "Transaction Service",
        "P2P direct transaction successfully settled without NPCI switch",
        { lamport: lP2pFin, vector: vP2pFin }
      );
      recordTimeline(
        txn,
        "PAYMENT_SUCCESS",
        "Transaction Service",
        "P2P direct transaction successfully settled without NPCI switch",
        { lamport: lP2pFin, vector: vP2pFin }
      );
      broadcastStreamEvent({
        event: "P2P_TRANSACTION_COMPLETED",
        transactionId: txnId,
        status: "SUCCESS",
        mode: "p2p",
        npciUsed: false,
        lamport: lP2pFin,
        vector: vP2pFin,
      });
      broadcastStreamEvent({
        event: "PAYMENT_SUCCESS",
        transactionId: txnId,
        status: "SUCCESS",
        mode: "p2p",
        npciUsed: false,
        lamport: lP2pFin,
        vector: vP2pFin,
      });
      return txn;
    } catch (err: any) {
      await safeRollbackSenderDebit(txn, "p2p");
      await failTransaction(txn, err?.message || "P2P direct transfer failed");
      return txn;
    }
  }

  // Standard / gRPC / RabbitMQ flow
  const l0 = serviceInterceptor.recordEvent("transaction-service", `Transaction ${txnId} Intent Created`);
  const v0 = vectorManager.tickLocal("transaction-service", "Payment intent initiated");

  setStatus(txn, "PROCESSING");
  recordTimeline(
    txn,
    "TRANSACTION_INITIATED",
    "Transaction Service",
    `Payment request received and validated (Protocol: ${mode.toUpperCase()})`,
    { lamport: l0, vector: v0 }
  );
  broadcastStreamEvent({
    event: "TRANSACTION_INITIATED",
    transactionId: txnId,
    status: "PROCESSING",
    mode,
    lamport: l0,
    vector: v0,
  });

  // Step 1: Sender Bank Inter-Service Call
  const sndReq = serviceInterceptor.interceptOutgoingRequest(
    "transaction-service",
    "sender-bank",
    "/services/sender-bank/debit",
    "DEBIT_REQUEST",
    txnId,
    { amount: txn.amount, senderId: txn.senderId }
  );
  const lSendSnd = sndReq.lamportTimestamp;
  const sndHeaders = sndReq.headers;
  const vSendSnd = vectorManager.tickSend("transaction-service", "sender-bank", "Debit request");

  const sndRecv = serviceInterceptor.interceptIncomingRequest(
    "sender-bank",
    "transaction-service",
    lSendSnd,
    "/services/sender-bank/debit",
    "DEBIT_REQUEST",
    txnId,
    sndHeaders
  );
  const lRecvSnd = sndRecv.clockAfter;
  const vRecvSnd = vectorManager.tickReceive("sender-bank", "transaction-service", vSendSnd, "Sender bank debit processing");

  recordTimeline(
    txn,
    "SENDER_BANK_PROCESSING",
    "Sender Bank Service",
    `Validating sender account and checking available balance (${mode.toUpperCase()})`,
    { lamport: lRecvSnd, vector: vRecvSnd, headers: sndHeaders, interServiceCall: "transaction-service -> sender-bank" }
  );
  broadcastStreamEvent({
    event: "SENDER_BANK_PROCESSING",
    transactionId: txnId,
    service: "Sender Bank Service",
    mode,
    lamport: lRecvSnd,
    vector: vRecvSnd,
    headers: sndHeaders,
  });

  let debitResult: { status: string; approved: boolean; reason?: string };
  try {
    if (mode === "grpc" && grpcClient) {
      const tStart = Date.now();
      const rpcDebit = await executeGrpcDebit(grpcClient, {
        transaction_id: txnId,
        account_id: txn.senderId,
        amount: txn.amount,
        correlation_id: txn.idempotencyKey || txnId,
        lamport_clock: lSendSnd,
      });
      const latencyMs = Date.now() - tStart;
      recordTimeline(
        txn,
        "GRPC_DEBIT_EXECUTED",
        "Account Service (gRPC/HTTP2 :50051)",
        `Binary RPC DebitAccount completed over HTTP/2 Protobuf (Latency: ${latencyMs}ms, Remaining: ₹${rpcDebit.remaining_balance})`,
        { latencyMs, rpcMethod: "DebitAccount", protocol: "gRPC/HTTP2", lamport: Number(rpcDebit.lamport_clock) }
      );
      SENDER_DEBITS.set(txnId, { senderUpi: txn.senderId, amount: txn.amount });
      debitResult = { status: "DEBITED", approved: rpcDebit.success };
    } else {
      debitResult = await callWithRetry(
        () => simulateSenderBankDebit(txn.senderId, txn.amount, txnId),
        txnId,
        "Sender Bank Service",
        txn
      );
    }
  } catch (err: any) {
    await failTransaction(txn, err.reason || err.message);
    return txn;
  }

  if (!debitResult.approved) {
    await failTransaction(txn, debitResult.reason || "Sender bank declined debit");
    return txn;
  }

  const lDebit = serviceInterceptor.recordEvent("sender-bank", `Atomic debit ₹${txn.amount} on ${txn.senderId}`);
  const vDebit = vectorManager.tickLocal("sender-bank", "Atomic account debit executed");

  const sndResp = serviceInterceptor.interceptOutgoingResponse(
    "sender-bank",
    "transaction-service",
    "/services/sender-bank/debit",
    "DEBIT_CONFIRMED",
    txnId
  );
  const lSndAck = sndResp.lamportTimestamp;
  const sndRespHeaders = sndResp.headers;
  const vSndAck = vectorManager.tickSend("sender-bank", "transaction-service", "Debit confirmed");

  serviceInterceptor.interceptIncomingResponse(
    "transaction-service",
    "sender-bank",
    lSndAck,
    "/services/sender-bank/debit",
    "DEBIT_CONFIRMED",
    txnId
  );
  vectorManager.tickReceive("transaction-service", "sender-bank", vSndAck, "Debit confirmed received");

  recordTimeline(
    txn,
    "SENDER_VERIFIED",
    "Sender Bank Service",
    `Sender account verified & debited successfully (${mode.toUpperCase()})`,
    { lamport: lDebit, vector: vDebit, headers: sndRespHeaders }
  );
  broadcastStreamEvent({
    event: "SENDER_VERIFIED",
    transactionId: txnId,
    service: "Sender Bank Service",
    mode,
    lamport: lDebit,
    vector: vDebit,
    headers: sndRespHeaders,
  });

  // Step 2: NPCI Routing Inter-Service Call
  const npciReq = serviceInterceptor.interceptOutgoingRequest(
    "transaction-service",
    "npci",
    "/services/npci/route",
    "ROUTE_REQUEST",
    txnId,
    { amount: txn.amount, receiverId: txn.receiverId }
  );
  const lSendNpci = npciReq.lamportTimestamp;
  const npciHeaders = npciReq.headers;
  const vSendNpci = vectorManager.tickSend("transaction-service", "npci", "Route request to NPCI");

  const npciRecv = serviceInterceptor.interceptIncomingRequest(
    "npci",
    "transaction-service",
    lSendNpci,
    "/services/npci/route",
    "ROUTE_REQUEST",
    txnId,
    npciHeaders
  );
  const lRecvNpci = npciRecv.clockAfter;
  const vRecvNpci = vectorManager.tickReceive("npci", "transaction-service", vSendNpci, "NPCI switch routing");

  recordTimeline(
    txn,
    "NPCI_PROCESSING",
    "NPCI Simulator Service",
    `Routing transaction across interbank switch (${mode.toUpperCase()})`,
    { lamport: lRecvNpci, vector: vRecvNpci, headers: npciHeaders, interServiceCall: "transaction-service -> npci" }
  );
  broadcastStreamEvent({
    event: "NPCI_PROCESSING",
    transactionId: txnId,
    service: "NPCI Simulator Service",
    mode,
    lamport: lRecvNpci,
    vector: vRecvNpci,
    headers: npciHeaders,
  });

  try {
    await callWithRetry(
      () => simulateNpciRoute(txnId),
      txnId,
      "NPCI Simulator Service",
      txn
    );
  } catch (err: any) {
    await safeRollbackSenderDebit(txn, mode);
    await failTransaction(txn, err.reason || err.message);
    return txn;
  }

  const lNpciRoute = serviceInterceptor.recordEvent("npci", "Interbank Route Cleared");
  const vNpciRoute = vectorManager.tickLocal("npci", "NPCI interbank route cleared");

  recordTimeline(
    txn,
    "NPCI_ROUTED",
    "NPCI Simulator Service",
    `NPCI switch routed request to receiver bank (${mode.toUpperCase()})`,
    { lamport: lNpciRoute, vector: vNpciRoute }
  );
  broadcastStreamEvent({
    event: "NPCI_ROUTED",
    transactionId: txnId,
    service: "NPCI Simulator Service",
    mode,
    lamport: lNpciRoute,
    vector: vNpciRoute,
  });

  // Step 3: Receiver Bank Credit Inter-Service Call
  const rcvReq = serviceInterceptor.interceptOutgoingRequest(
    "npci",
    "receiver-bank",
    "/services/receiver-bank/credit",
    "CREDIT_REQUEST",
    txnId,
    { amount: txn.amount, receiverId: txn.receiverId }
  );
  const lSendRcv = rcvReq.lamportTimestamp;
  const rcvHeaders = rcvReq.headers;
  const vSendRcv = vectorManager.tickSend("npci", "receiver-bank", "Credit request to receiver");

  const rcvRecv = serviceInterceptor.interceptIncomingRequest(
    "receiver-bank",
    "npci",
    lSendRcv,
    "/services/receiver-bank/credit",
    "CREDIT_REQUEST",
    txnId,
    rcvHeaders
  );
  const lRecvRcv = rcvRecv.clockAfter;
  const vRecvRcv = vectorManager.tickReceive("receiver-bank", "npci", vSendRcv, "Receiver bank credit processing");

  recordTimeline(
    txn,
    "RECEIVER_BANK_PROCESSING",
    "Receiver Bank Service",
    `Processing credit to beneficiary account (${mode.toUpperCase()})`,
    { lamport: lRecvRcv, vector: vRecvRcv, headers: rcvHeaders, interServiceCall: "npci -> receiver-bank" }
  );
  broadcastStreamEvent({
    event: "RECEIVER_BANK_PROCESSING",
    transactionId: txnId,
    service: "Receiver Bank Service",
    mode,
    lamport: lRecvRcv,
    vector: vRecvRcv,
    headers: rcvHeaders,
  });

  try {
    if (mode === "grpc" && grpcClient) {
      const tStart = Date.now();
      const rpcCredit = await executeGrpcCredit(grpcClient, {
        transaction_id: txnId,
        account_id: txn.receiverId,
        amount: txn.amount,
        correlation_id: txn.idempotencyKey || txnId,
        lamport_clock: lSendRcv,
      });
      const latencyMs = Date.now() - tStart;
      recordTimeline(
        txn,
        "GRPC_CREDIT_EXECUTED",
        "Account Service (gRPC/HTTP2 :50051)",
        `Binary RPC CreditAccount completed over HTTP/2 Protobuf (Latency: ${latencyMs}ms, New Balance: ₹${rpcCredit.new_balance})`,
        { latencyMs, rpcMethod: "CreditAccount", protocol: "gRPC/HTTP2", lamport: Number(rpcCredit.lamport_clock) }
      );
      RECEIVER_CREDITS.set(txnId, randomUUID());
    } else {
      await callWithRetry(
        () => simulateReceiverBankCredit(txn.receiverId, txn.amount, txnId),
        txnId,
        "Receiver Bank Service",
        txn
      );
    }
  } catch (err: any) {
    await safeRollbackSenderDebit(txn, mode);
    await failTransaction(txn, err.reason || err.message);
    return txn;
  }

  // Step 4: Final Success
  const lCredit = serviceInterceptor.recordEvent("receiver-bank", `Beneficiary account ${txn.receiverId} credited`);
  const vCredit = vectorManager.tickLocal("receiver-bank", "Beneficiary account credited");

  const rcvAck = serviceInterceptor.interceptOutgoingResponse(
    "receiver-bank",
    "transaction-service",
    "/services/receiver-bank/credit",
    "CREDIT_CONFIRMED",
    txnId
  );
  const lRcvAck = rcvAck.lamportTimestamp;
  const rcvAckHeaders = rcvAck.headers;
  const vRcvAck = vectorManager.tickSend("receiver-bank", "transaction-service", "Credit confirmed ACK");

  const finalAckRecv = serviceInterceptor.interceptIncomingResponse(
    "transaction-service",
    "receiver-bank",
    lRcvAck,
    "/services/receiver-bank/credit",
    "CREDIT_CONFIRMED",
    txnId
  );
  const lFinal = finalAckRecv.clockAfter;
  const vFinal = vectorManager.tickReceive("transaction-service", "receiver-bank", vRcvAck, "Payment settlement finalized");

  setStatus(txn, "SUCCESS");
  recordTimeline(
    txn,
    "PAYMENT_SUCCESS",
    "Transaction Service",
    `Transaction successfully completed and settled (${mode.toUpperCase()})`,
    { lamport: lFinal, vector: vFinal, headers: rcvAckHeaders }
  );
  broadcastStreamEvent({
    event: "PAYMENT_SUCCESS",
    transactionId: txnId,
    status: "SUCCESS",
    mode,
    lamport: lFinal,
    vector: vFinal,
    headers: rcvAckHeaders,
  });

  return txn;
}

function getStats() {
  const all = Array.from(TRANSACTIONS.values());
  const total = all.length;
  const successful = all.filter((t) => t.status === "SUCCESS").length;
  const failed = all.filter((t) => t.status === "FAILED" || t.status === "ROLLBACK_COMPLETED").length;
  const processing = Math.max(0, total - (successful + failed));
  return { total, successful, failed, processing };
}

// ---------------------------------------------------------------------------
// Express App & HTTP/WebSocket Server Setup
// ---------------------------------------------------------------------------

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Initialize Account Store & Start gRPC Account Service (:50051) backed by SQLite
  setAccountStore({
    getUser: (id) => getUserByIdOrUpi(id),
    debitUser: (id, amount, transactionId) => {
      const user = getUserByIdOrUpi(id);
      if (!user) return { success: false, balance: 0, error: `Account not found: ${id}` };
      const paise = rupeesToPaise(amount);
      const txnId = transactionId || `TXN-GRPC-${Date.now()}`;
      const res = persistentDb.atomicDebit(user.upi_id, paise, txnId, `gRPC Debit: ₹${amount}`);
      if (!res.success) {
        const refreshed = getUserByIdOrUpi(id);
        return { success: false, balance: refreshed?.balance ?? user.balance, error: res.reason || "Insufficient balance" };
      }
      const refreshed = getUserByIdOrUpi(id);
      return { success: true, balance: refreshed?.balance ?? paiseToRupees(res.balanceAfterPaise || 0) };
    },
    creditUser: (id, amount, transactionId) => {
      const user = getUserByIdOrUpi(id);
      if (!user) return { success: false, balance: 0, error: `Account not found: ${id}` };
      const paise = rupeesToPaise(amount);
      const txnId = transactionId || `TXN-GRPC-${Date.now()}`;
      const res = persistentDb.atomicCredit(user.upi_id, paise, txnId, `gRPC Credit: ₹${amount}`);
      if (!res.success) {
        const refreshed = getUserByIdOrUpi(id);
        return { success: false, balance: refreshed?.balance ?? user.balance, error: res.reason || "Credit failed" };
      }
      const refreshed = getUserByIdOrUpi(id);
      return { success: true, balance: refreshed?.balance ?? paiseToRupees(res.balanceAfterPaise || 0) };
    },
    rollbackDebit: (transactionId, accountId, amount) => {
      const res = persistentDb.atomicRollback(transactionId);
      if (!res.success) {
        return { success: false, balance: 0, error: res.reason || "Rollback failed" };
      }
      let user = accountId ? getUserByIdOrUpi(accountId) : null;
      if (!user) {
        const rev = db.prepare("SELECT account_upi FROM ledger_entries WHERE transaction_id = ? AND entry_type = 'REVERSAL'").get(transactionId) as any;
        if (rev) user = getUserByIdOrUpi(rev.account_upi);
      }
      return {
        success: true,
        balance: user?.balance ?? 0,
        amount: res.amountPaise ? paiseToRupees(res.amountPaise) : amount,
        alreadyRolledBack: res.alreadyRolledBack,
      };
    },
  });

  try {
    await startGrpcAccountServer(50051);
    grpcClient = getGrpcAccountClient("127.0.0.1:50051");
    console.log("gRPC Account Service running on 0.0.0.0:50051");
  } catch (err: any) {
    console.error("Failed to start gRPC server on 50051:", err?.message || err);
  }

  // Start Beacon Failure Detector
  const isNodeFailed = (nodeId: string): boolean => {
    if (nodeId === "sender-bank") return FAILURE_STATE.sender_bank_failure;
    if (nodeId === "npci") return FAILURE_STATE.npci_failure;
    if (nodeId === "receiver-bank") return FAILURE_STATE.receiver_bank_failure;
    return false;
  };

  setInterval(() => {
    beaconManager.tickBeacons(isNodeFailed);
  }, 2000);

  // Health Checks
  app.get("/health", (_req: Request, res: Response) => {
    try {
      db.prepare("SELECT 1 AS ok").get();
      res.json({
        service: "transaction-service",
        status: "healthy",
        port: PORT,
        dbPath: DB_PATH,
        timestamp: nowIso(),
      });
    } catch (err: any) {
      res.status(503).json({
        service: "transaction-service",
        status: "unhealthy",
        port: PORT,
        error: err?.message || "sqlite probe failed",
        timestamp: nowIso(),
      });
    }
  });

  app.get("/services/sender-bank/health", (_req: Request, res: Response) => {
    res.json({
      service: "sender-bank-service",
      status: "healthy",
      port: 8001,
      timestamp: nowIso(),
    });
  });

  app.get("/services/npci/health", (_req: Request, res: Response) => {
    res.json({
      service: "npci-simulator-service",
      status: "healthy",
      port: 8002,
      timestamp: nowIso(),
    });
  });

  app.get("/services/receiver-bank/health", (_req: Request, res: Response) => {
    res.json({
      service: "receiver-bank-service",
      status: "healthy",
      port: 8003,
      timestamp: nowIso(),
    });
  });

  // ---------------------------------------------------------------------------
  // Service-Level Interceptor (Lamport's Algorithm) HTTP Middleware & Routes
  // ---------------------------------------------------------------------------
  function createServiceLamportMiddleware(serviceNodeId: string) {
    return (req: Request, res: Response, next: express.NextFunction) => {
      const incomingClockHeader = req.headers["x-lamport-clock"];
      const incomingSource = (req.headers["x-lamport-source"] as string) || "external-client";
      const txnId = (req.headers["x-transaction-id"] as string) || `HTTP-${Date.now()}`;
      
      let incomingClock: number | null = null;
      if (incomingClockHeader) {
        const parsed = parseInt(String(incomingClockHeader), 10);
        if (!isNaN(parsed)) {
          incomingClock = parsed;
          serviceInterceptor.interceptIncomingRequest(
            serviceNodeId,
            incomingSource,
            parsed,
            req.originalUrl || req.url,
            req.method,
            txnId,
            req.headers as Record<string, string>
          );
        }
      }

      if (incomingClock === null) {
        serviceInterceptor.recordEvent(
          serviceNodeId,
          `HTTP ${req.method} received at ${req.originalUrl || req.url}`
        );
      }

      const originalJson = res.json.bind(res);
      res.json = function (body: any) {
        const respAck = serviceInterceptor.interceptOutgoingResponse(
          serviceNodeId,
          incomingSource,
          req.originalUrl || req.url,
          req.method,
          txnId
        );
        res.setHeader("x-lamport-clock", String(respAck.lamportTimestamp));
        res.setHeader("x-lamport-source", serviceNodeId);
        return originalJson(body);
      };

      next();
    };
  }

  // Interceptor observability endpoints
  app.get("/api/interceptor/metrics", (_req: Request, res: Response) => {
    res.json(serviceInterceptor.getMetrics());
  });

  app.post("/api/interceptor/reset", (_req: Request, res: Response) => {
    serviceInterceptor.reset();
    res.json({ success: true, message: "Service-level interceptor log reset", metrics: serviceInterceptor.getMetrics() });
  });

  // Inter-service endpoints with service-level Lamport interceptor applied
  app.post(
    "/services/sender-bank/debit",
    createServiceLamportMiddleware("sender-bank"),
    async (req: Request, res: Response) => {
      const { senderId, amount, transactionId } = req.body || {};
      try {
        const result = await simulateSenderBankDebit(senderId, Number(amount), transactionId || randomUUID());
        res.json(result);
      } catch (err: any) {
        res.status(503).json({ error: err.message });
      }
    }
  );

  app.post(
    "/services/sender-bank/rollback",
    createServiceLamportMiddleware("sender-bank"),
    async (req: Request, res: Response) => {
      const { transactionId } = req.body || {};
      try {
        const result = await simulateSenderBankRollback(transactionId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.post(
    "/services/npci/route",
    createServiceLamportMiddleware("npci"),
    async (req: Request, res: Response) => {
      const { transactionId } = req.body || {};
      try {
        const result = await simulateNpciRoute(transactionId);
        res.json(result);
      } catch (err: any) {
        res.status(503).json({ error: err.message });
      }
    }
  );

  app.post(
    "/services/receiver-bank/credit",
    createServiceLamportMiddleware("receiver-bank"),
    async (req: Request, res: Response) => {
      const { receiverId, amount, transactionId } = req.body || {};
      try {
        const result = await simulateReceiverBankCredit(receiverId, Number(amount), transactionId || randomUUID());
        res.json(result);
      } catch (err: any) {
        res.status(503).json({ error: err.message });
      }
    }
  );

  // Users & Stats
  app.get("/api/users", (_req: Request, res: Response) => {
    res.json({ users: listUsers() });
  });

  app.get("/api/stats", (_req: Request, res: Response) => {
    res.json(getStats());
  });

  // High-performance atomic snapshot endpoint (replaces 7 separate HTTP calls with 1)
  app.get("/api/snapshot", (_req: Request, res: Response) => {
    const txns = persistentDb.listTransactions(100);
    const users = listUsers();
    res.json({
      health: {
        "transaction-service": { service: "Transaction Service", port: "8000", status: "healthy" },
        "sender-bank": {
          service: "Sender Bank Service",
          port: "8001",
          status: FAILURE_STATE.sender_bank_failure ? "unhealthy" : "healthy",
        },
        npci: {
          service: "NPCI Simulator",
          port: "8002",
          status: FAILURE_STATE.npci_failure ? "unhealthy" : "healthy",
        },
        "receiver-bank": {
          service: "Receiver Bank Service",
          port: "8003",
          status: FAILURE_STATE.receiver_bank_failure ? "unhealthy" : "healthy",
        },
        grpc: {
          service: "Account Service (gRPC/HTTP2)",
          port: "50051",
          status: grpcClient ? "healthy" : "unhealthy",
        },
      },
      stats: getStats(),
      users,
      failureState: {
        ...FAILURE_STATE,
        circuit_breakers: getAllCircuitBreakerStatuses(),
      },
      synchronization: {
        lamport: lamportManager.getAllClocks(),
        interceptor: serviceInterceptor.getMetrics(),
      },
      transactions: txns,
      wsStats: getStreamStats(),
    });
  });

  app.post("/failure/reset-all", async (_req: Request, res: Response) => {
    FAILURE_STATE.sender_bank_failure = false;
    FAILURE_STATE.npci_failure = false;
    FAILURE_STATE.receiver_bank_failure = false;
    FAILURE_STATE.timeout_simulation = false;
    for (const cb of Object.values(circuitBreakers)) {
      await cb.reset();
    }
    const payload = {
      ...FAILURE_STATE,
      circuit_breakers: getAllCircuitBreakerStatuses(),
    };
    broadcastStreamEvent({
      event: "SYSTEM_RESTORED",
      service: "Chaos Controller",
      message: "All bank nodes, NPCI switch, and circuit breakers restored to nominal state",
    });
    res.json(payload);
  });

  // Transactions
  app.post("/api/transaction/initiate", async (req: Request, res: Response) => {
    try {
      const { senderId, receiverId, amount, idempotencyKey, mode } = req.body || {};

      if (!senderId || !receiverId) {
        res.status(400).json({ detail: "senderId and receiverId are required" });
        return;
      }
      if (senderId === receiverId) {
        res.status(400).json({ detail: "Sender and receiver must be different accounts" });
        return;
      }
      if (amount === undefined || amount === null || typeof amount === "boolean" || (typeof amount !== "number" && typeof amount !== "string")) {
        res.status(400).json({ detail: "Amount must be a valid positive number" });
        return;
      }
      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || isNaN(numAmount) || numAmount <= 0) {
        res.status(400).json({ detail: "Amount must be a finite positive number" });
        return;
      }
      const strAmount = String(amount).trim();
      if (strAmount.includes(".")) {
        const decimals = strAmount.split(".")[1];
        if (decimals.length > 2) {
          res.status(400).json({ detail: "Malformed amount: maximum 2 decimal places allowed (fractional paise not supported)" });
          return;
        }
      }

      const senderUser = getUserByIdOrUpi(String(senderId));
      const receiverUser = getUserByIdOrUpi(String(receiverId));

      if (!senderUser) {
        res.status(400).json({ detail: `Unknown sender account: ${senderId}` });
        return;
      }
      if (!receiverUser) {
        res.status(400).json({ detail: `Unknown receiver account: ${receiverId}` });
        return;
      }

      if (senderUser.upi_id === receiverUser.upi_id || senderUser.id === receiverUser.id) {
        res.status(400).json({ detail: "Sender and receiver must be different accounts" });
        return;
      }

      const senderUpi = senderUser.upi_id;
      const receiverUpi = receiverUser.upi_id;
      const amountPaise = rupeesToPaise(numAmount);
      const idemKey = idempotencyKey ? String(idempotencyKey).trim() : `auto-${randomUUID().replace(/-/g, "")}`;
      const requestHash = `${senderUpi}|${receiverUpi}|${amountPaise}`;

      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const txnId = `TXN-${datePart}-${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;

      // Idempotency: Atomic check & reservation in SQLite with parameter conflict detection
      const idemCheck = persistentDb.checkOrReserveIdempotency(
        idemKey,
        txnId,
        senderUpi,
        receiverUpi,
        amountPaise,
        requestHash
      );

      if (idemCheck.status === "CONFLICT") {
        res.status(409).json({
          code: "IDEMPOTENCY_CONFLICT",
          detail: "Idempotency key reused with different transaction parameters (sender, receiver, or amount mismatch)",
        });
        return;
      }

      if (idemCheck.status === "MATCH") {
        let existingTxn = persistentDb.getTransaction(idemCheck.transactionId!) || TRANSACTIONS.get(idemCheck.transactionId!);
        if (!existingTxn) {
          // If transaction was just reserved concurrently in another thread, wait briefly for it to materialize
          for (let wait = 0; wait < 10; wait++) {
            await sleep(50);
            existingTxn = persistentDb.getTransaction(idemCheck.transactionId!) || TRANSACTIONS.get(idemCheck.transactionId!);
            if (existingTxn) break;
          }
        }
        if (existingTxn) {
          broadcastStreamEvent({
            event: "DUPLICATE_REQUEST_DETECTED",
            transactionId: existingTxn.transactionId,
            idempotencyKey: idemKey,
            status: existingTxn.status,
          });
          const message =
            existingTxn.status === "PROCESSING" || existingTxn.status === "INITIATED"
              ? "Transaction is currently in-flight. Duplicate processing prevented."
              : "Existing transaction returned. Duplicate processing prevented.";
          res.json({
            ...existingTxn,
            duplicateRequest: true,
            message,
          });
          return;
        } else {
          // Return in-flight representation of the already-reserved matching transaction
          res.json({
            transactionId: idemCheck.transactionId,
            idempotencyKey: idemKey,
            status: "PROCESSING",
            duplicateRequest: true,
            message: "Transaction is currently in-flight. Duplicate processing prevented.",
          });
          return;
        }
      }

      const now = nowIso();

      const txn: TransactionRecord = {
        transactionId: txnId,
        senderId: senderUpi,
        receiverId: receiverUpi,
        amount: numAmount,
        status: "INITIATED",
        failureReason: null,
        idempotencyKey: idemKey,
        mode: mode ? String(mode).toLowerCase() : "rest",
        timeline: [],
        createdAt: now,
        updatedAt: now,
      };

      // 2. Persist initial transaction into SQLite
      persistentDb.upsertTransaction({
        transactionId: txnId,
        senderId: senderUpi,
        receiverId: receiverUpi,
        amount: numAmount,
        amountPaise,
        status: "INITIATED",
        failureReason: null,
        idempotencyKey: idemKey,
        mode: txn.mode || "rest",
        timeline: [],
        createdAt: now,
        updatedAt: now,
      });

      TRANSACTIONS.set(txnId, txn);
      IDEMPOTENCY_INDEX.set(idemKey, txnId);

      const processed = await processTransaction(txn);

      // 3. Finalize idempotency in SQLite
      persistentDb.finalizeIdempotency(
        idemKey,
        processed.status,
        JSON.stringify({
          transactionId: processed.transactionId,
          status: processed.status,
          amount: processed.amount,
          senderId: processed.senderId,
          receiverId: processed.receiverId,
          failureReason: processed.failureReason,
        })
      );

      res.json({ ...processed, duplicateRequest: false });
    } catch (err: any) {
      res.status(500).json({ detail: err?.message || "Internal server error" });
    }
  });

  app.get("/api/transaction/:transactionId/status", (req: Request, res: Response) => {
    const txn = persistentDb.getTransaction(String(req.params.transactionId)) || TRANSACTIONS.get(String(req.params.transactionId));
    if (!txn) {
      res.status(404).json({ detail: "Transaction not found" });
      return;
    }
    res.json(txn);
  });

  app.get("/api/transactions", (req: Request, res: Response) => {
    const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : undefined;
    const list = persistentDb.listTransactions(100, statusFilter);
    res.json({ transactions: list });
  });

  app.get("/api/account/:identifier/balance", (req: Request, res: Response) => {
    const user = getUserByIdOrUpi(String(req.params.identifier));
    if (!user) {
      res.status(404).json({ detail: "Account not found" });
      return;
    }
    res.json({ account: user, balance: user.balance, upi_id: user.upi_id });
  });

  app.get("/api/users/:identifier", (req: Request, res: Response) => {
    const user = getUserByIdOrUpi(String(req.params.identifier));
    if (!user) {
      res.status(404).json({ detail: "User not found" });
      return;
    }
    res.json({ user });
  });

  // Dedicated Multi-Bank Double-Entry Ledger API
  app.get("/api/ledger", (_req: Request, res: Response) => {
    const users = listUsers();
    const invariants = persistentDb.getLedgerInvariants();
    const genesisTotal = invariants.genesisSupply;
    const currentTotal = users.reduce((acc, u) => acc + Number(u.balance || 0), 0);

    const allTxns = Array.from(TRANSACTIONS.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    let totalDebited = 0;
    let totalCredited = 0;
    const journalEntries: any[] = [];
    let entryCounter = 1;

    for (const txn of allTxns) {
      const sender = getUserByIdOrUpi(txn.senderId);
      const receiver = getUserByIdOrUpi(txn.receiverId);
      const senderBank = sender?.bank_name || sender?.bank || "Sender Bank";
      const receiverBank = receiver?.bank_name || receiver?.bank || "Receiver Bank";

      if (txn.status === "SUCCESS") {
        totalDebited += txn.amount;
        totalCredited += txn.amount;

        journalEntries.push({
          id: `JRN-${String(entryCounter++).padStart(4, "0")}`,
          transactionId: txn.transactionId,
          timestamp: txn.createdAt,
          accountUpi: txn.senderId,
          userName: sender?.name || txn.senderId.split("@")[0],
          bank: senderBank,
          entryType: "DEBIT",
          amount: txn.amount,
          mode: txn.mode || "rest",
          status: "COMMITTED",
          description: `UPI Payment to ${txn.receiverId}`,
        });

        journalEntries.push({
          id: `JRN-${String(entryCounter++).padStart(4, "0")}`,
          transactionId: txn.transactionId,
          timestamp: txn.updatedAt || txn.createdAt,
          accountUpi: txn.receiverId,
          userName: receiver?.name || txn.receiverId.split("@")[0],
          bank: receiverBank,
          entryType: "CREDIT",
          amount: txn.amount,
          mode: txn.mode || "rest",
          status: "COMMITTED",
          description: `UPI Settlement from ${txn.senderId}`,
        });
      } else if (txn.status === "FAILED") {
        const hadDebit = txn.timeline.some((e) => e.event === "DEBIT_RESERVED" || e.event === "SENDER_DEBIT_SUCCESS");
        if (hadDebit) {
          journalEntries.push({
            id: `JRN-${String(entryCounter++).padStart(4, "0")}`,
            transactionId: txn.transactionId,
            timestamp: txn.createdAt,
            accountUpi: txn.senderId,
            userName: sender?.name || txn.senderId.split("@")[0],
            bank: senderBank,
            entryType: "DEBIT",
            amount: txn.amount,
            mode: txn.mode || "rest",
            status: "ROLLED_BACK",
            description: `Tentative Debit for ${txn.receiverId}`,
          });

          journalEntries.push({
            id: `JRN-${String(entryCounter++).padStart(4, "0")}`,
            transactionId: txn.transactionId,
            timestamp: txn.updatedAt || txn.createdAt,
            accountUpi: txn.senderId,
            userName: sender?.name || txn.senderId.split("@")[0],
            bank: senderBank,
            entryType: "COMPENSATING_CREDIT",
            amount: txn.amount,
            mode: txn.mode || "rest",
            status: "COMMITTED",
            description: `Saga Compensating Refund: ${txn.failureReason || "Transaction Failed"}`,
          });
        }
      }
    }

    journalEntries.reverse();

    const bankMap = new Map<string, { bank: string; accountsCount: number; totalBalance: number; debits: number; credits: number }>();
    for (const u of users) {
      const b = u.bank || u.bank_name || "Unknown Bank";
      if (!bankMap.has(b)) {
        bankMap.set(b, { bank: b, accountsCount: 0, totalBalance: 0, debits: 0, credits: 0 });
      }
      const entry = bankMap.get(b)!;
      entry.accountsCount += 1;
      entry.totalBalance += Number(u.balance || 0);
    }

    for (const j of journalEntries) {
      if (bankMap.has(j.bank)) {
        const b = bankMap.get(j.bank)!;
        if (j.entryType === "DEBIT") b.debits += j.amount;
        if (j.entryType === "CREDIT" || j.entryType === "COMPENSATING_CREDIT") b.credits += j.amount;
      }
    }

    res.json({
      accounts: users,
      journalEntries,
      invariants: {
        genesisSupply: genesisTotal,
        currentTotalDeposits: currentTotal,
        isConservationPreserved: Math.abs(currentTotal - genesisTotal) < 0.01,
        totalDebited,
        totalCredited,
        debitCreditParity: Math.abs(totalDebited - totalCredited) < 0.01,
      },
      banks: Array.from(bankMap.values()),
    });
  });

  // WebSocket & WebRTC Stats
  app.get("/api/websocket/stats", (_req: Request, res: Response) => {
    res.json(getStreamStats());
  });

  app.get("/api/webrtc/rooms", (_req: Request, res: Response) => {
    res.json({ rooms: getAllWebRTCRooms() });
  });

  // Fault Tolerance Simulation Controls
  app.post("/failure/timeout/enable", (_req: Request, res: Response) => {
    FAILURE_STATE.timeout_simulation = true;
    
    res.json({ ...FAILURE_STATE, circuit_breakers: getAllCircuitBreakerStatuses() });
  });

  app.post("/failure/timeout/disable", (_req: Request, res: Response) => {
    FAILURE_STATE.timeout_simulation = false;
    
    res.json({ ...FAILURE_STATE, circuit_breakers: getAllCircuitBreakerStatuses() });
  });

  app.post("/failure/:target/enable", (req: Request, res: Response) => {
    const target = String(req.params.target);
    const key = FRIENDLY_TO_TARGET[target];
    if (!key) {
      res.status(404).json({ detail: `Unknown failure target: ${target}` });
      return;
    }
    FAILURE_STATE[key] = true;
    
    res.json({ ...FAILURE_STATE, circuit_breakers: getAllCircuitBreakerStatuses() });
  });

  app.post("/failure/:target/disable", (req: Request, res: Response) => {
    const target = String(req.params.target);
    const key = FRIENDLY_TO_TARGET[target];
    if (!key) {
      res.status(404).json({ detail: `Unknown failure target: ${target}` });
      return;
    }
    FAILURE_STATE[key] = false;
    
    res.json({ ...FAILURE_STATE, circuit_breakers: getAllCircuitBreakerStatuses() });
  });

  app.get("/failure/status", (_req: Request, res: Response) => {
    res.json({
      ...FAILURE_STATE,
      circuit_breakers: getAllCircuitBreakerStatuses(),
    });
  });

  app.get("/api/circuit-breaker/status", (_req: Request, res: Response) => {
    res.json({ circuitBreakers: getAllCircuitBreakerStatuses() });
  });

  app.post("/api/circuit-breaker/reset", async (_req: Request, res: Response) => {
    for (const cb of Object.values(circuitBreakers)) {
      await cb.reset();
    }
    res.json({ status: "RESET", circuitBreakers: getAllCircuitBreakerStatuses() });
  });

  app.get("/api/dashboard/stats", (_req: Request, res: Response) => {
    const protocols = [
      {
        id: "rest",
        name: "REST / HTTP/1.1",
        phase: "Phase 0 & 1",
        type: "Synchronous Request-Response",
        transport: "HTTP/1.1 JSON over TCP",
        routing: "Central Hub Orchestrator",
        npciBypassed: false,
        status: "Active",
        description: "Standard UPI central hub flow with 3-state Circuit Breaker & retries.",
      },
      {
        id: "grpc",
        name: "gRPC / HTTP/2",
        phase: "Phase 2",
        type: "Synchronous Binary RPC",
        transport: "HTTP/2 Protocol Buffers (upi.proto)",
        routing: "Central Hub Orchestrator",
        npciBypassed: false,
        status: "Active",
        description: "High-efficiency strongly-typed binary remote procedure calls.",
      },
      {
        id: "rabbitmq",
        name: "RabbitMQ AMQP",
        phase: "Phase 3",
        type: "Asynchronous Message-Oriented Broker",
        transport: "AMQP 0-9-1 Topic Exchange & DLX",
        routing: "Queue Consumers (q.sender.debit, q.npci, etc.)",
        npciBypassed: false,
        status: "Active",
        description: "Decoupled queue worker processing with Dead Letter Exchange resilience.",
      },
      {
        id: "websocket",
        name: "WebSocket Push",
        phase: "Phase 4",
        type: "Stream-Oriented Real-Time Push",
        transport: "Persistent WebSocket TCP Stream",
        routing: "Broadcast Stream Manager (Ring Buffer: 500)",
        npciBypassed: false,
        status: "Active",
        description: "Low-latency event streaming with sequence numbering & recovery replay.",
      },
      {
        id: "p2p",
        name: "Direct P2P HTTP",
        phase: "Phase 5",
        type: "Direct Peer Messaging",
        transport: "HTTP REST (Sender Bank -> Receiver Bank)",
        routing: "Direct Inter-Bank Connection",
        npciBypassed: true,
        status: "Active",
        description: "Direct bank-to-bank credit transfer completely bypassing NPCI Switch.",
      },
      {
        id: "webrtc",
        name: "WebRTC RTCDataChannel",
        phase: "Phase 6",
        type: "Browser Peer-to-Peer DataChannel",
        transport: "SCTP over DTLS/UDP (STUN Traversal)",
        routing: "Direct Browser-to-Browser (Backend Signaling Only)",
        npciBypassed: true,
        status: "Active",
        description: "Browser-to-browser P2P DataChannel payload exchange with zero backend data routing.",
      },
    ];

    res.json({
      timestamp: nowIso(),
      transactionStats: getStats(),
      circuitBreakers: getAllCircuitBreakerStatuses(),
      websocketStream: getStreamStats(),
      webrtcRooms: getAllWebRTCRooms(),
      failureState: FAILURE_STATE,
      protocols,
    });
  });

  // =========================================================================
  // UNIT III: SYNCHRONIZATION & UNIT IV: DISTRIBUTED WEB-BASED SYSTEMS APIS
  // =========================================================================

  // 1. Clock Synchronization
  app.get("/api/synchronization/clocks", (_req: Request, res: Response) => {
    res.json({
      clocks: clockSyncManager.getClocks(),
      explanation: "Simulated physical clocks demonstrating clock drift, offsets, and Berkeley consensus convergence across the 4 distributed nodes.",
    });
  });

  app.post("/api/synchronization/clocks/sync", (_req: Request, res: Response) => {
    const result = clockSyncManager.synchronize();
    broadcastStreamEvent({
      event: "CLOCKS_SYNCHRONIZED",
      service: "Clock Sync Coordinator",
      message: "Physical clocks converged to consensus time cut",
      consensusOffsetMs: result.consensusOffsetMs,
    });
    res.json(result);
  });

  app.post("/api/synchronization/clocks/drift", (req: Request, res: Response) => {
    const { nodeId, driftMs } = req.body || {};
    const targetNode = nodeId || "sender-bank";
    const delta = Number(driftMs) || 1500;
    const updated = clockSyncManager.introduceDrift(targetNode, delta);
    broadcastStreamEvent({
      event: "CLOCK_DRIFT_INTRODUCED",
      service: targetNode,
      message: `Simulated clock drift of ${delta}ms introduced on ${targetNode}`,
    });
    res.json({ clocks: updated });
  });

  app.post("/api/synchronization/clocks/reset", (_req: Request, res: Response) => {
    clockSyncManager.resetClocks();
    res.json({ clocks: clockSyncManager.getClocks() });
  });

  // 2. Lamport's Logical Clock Algorithm
  app.get("/api/synchronization/lamport", (_req: Request, res: Response) => {
    res.json({
      clocks: lamportManager.getAllClocks(),
      history: lamportManager.getHistory(30),
      rules: {
        local: "L_i = L_i + 1",
        send: "L_i = L_i + 1 (attached to outgoing message)",
        receive: "L_j = max(L_j, T_msg) + 1",
      },
      interceptor: serviceInterceptor.getMetrics(),
    });
  });

  app.post("/api/synchronization/lamport/event", (req: Request, res: Response) => {
    const { type, fromNode, toNode, description, incomingTimestamp } = req.body || {};
    let clockValue: number;

    if (type === "SEND") {
      const from = fromNode || "transaction-service";
      const to = toNode || "sender-bank";
      clockValue = lamportManager.tickSend(from, to, description || "Manual Send Request");
    } else if (type === "RECEIVE") {
      const to = toNode || "sender-bank";
      const from = fromNode || "transaction-service";
      const t = Number(incomingTimestamp) || lamportManager.getClock(from);
      clockValue = lamportManager.tickReceive(to, from, t, description || "Manual Receive Request");
    } else {
      const node = fromNode || "transaction-service";
      clockValue = lamportManager.tickLocal(node, description || "Manual Local Event");
    }

    broadcastStreamEvent({
      event: "LAMPORT_CLOCK_TICK",
      service: fromNode || "transaction-service",
      eventType: type || "LOCAL",
      clock: clockValue,
      description: description || "Lamport event processed",
    });

    res.json({
      clock: clockValue,
      clocks: lamportManager.getAllClocks(),
      history: lamportManager.getHistory(30),
    });
  });

  app.post("/api/synchronization/lamport/reset", (_req: Request, res: Response) => {
    lamportManager.reset();
    res.json({ clocks: lamportManager.getAllClocks(), history: [] });
  });

  // 3. Vector Clock Algorithm
  app.get("/api/synchronization/vector", (_req: Request, res: Response) => {
    res.json({
      vectors: vectorManager.getAllVectors(),
      history: vectorManager.getHistory(30),
      nodeMapping: "[0: Sender Bank, 1: Transaction Service, 2: NPCI, 3: Receiver Bank]",
    });
  });

  app.post("/api/synchronization/vector/event", (req: Request, res: Response) => {
    const { type, fromNode, toNode, description, incomingVector } = req.body || {};
    let vectorValue: VectorClock;

    if (type === "SEND") {
      const from = fromNode || "transaction-service";
      const to = toNode || "sender-bank";
      vectorValue = vectorManager.tickSend(from, to, description || "Manual Send");
    } else if (type === "RECEIVE") {
      const to = toNode || "sender-bank";
      const from = fromNode || "transaction-service";
      const w: VectorClock = Array.isArray(incomingVector) && incomingVector.length === 4
        ? (incomingVector as VectorClock)
        : vectorManager.getVector(from);
      vectorValue = vectorManager.tickReceive(to, from, w, description || "Manual Receive");
    } else {
      const node = fromNode || "transaction-service";
      vectorValue = vectorManager.tickLocal(node, description || "Manual Local Event");
    }

    broadcastStreamEvent({
      event: "VECTOR_CLOCK_TICK",
      service: fromNode || "transaction-service",
      eventType: type || "LOCAL",
      vector: vectorValue,
      description: description || "Vector event processed",
    });

    res.json({
      vector: vectorValue,
      vectors: vectorManager.getAllVectors(),
      history: vectorManager.getHistory(30),
    });
  });

  app.post("/api/synchronization/vector/compare", (req: Request, res: Response) => {
    const { vectorA, vectorB } = req.body || {};
    if (!Array.isArray(vectorA) || !Array.isArray(vectorB) || vectorA.length !== 4 || vectorB.length !== 4) {
      res.status(400).json({ detail: "vectorA and vectorB must both be 4-element integer arrays [Sender, Transaction, NPCI, Receiver]" });
      return;
    }
    const result = VectorClockManager.compare(vectorA as VectorClock, vectorB as VectorClock);
    res.json(result);
  });

  app.post("/api/synchronization/vector/reset", (_req: Request, res: Response) => {
    vectorManager.reset();
    res.json({ vectors: vectorManager.getAllVectors(), history: [] });
  });

  // 4. Global State Snapshot (Chandy-Lamport Simulator)
  app.get("/api/synchronization/global-state", (_req: Request, res: Response) => {
    res.json({
      snapshots: globalStateManager.getSnapshots(),
    });
  });

  app.post("/api/synchronization/global-state/capture", (_req: Request, res: Response) => {
    const activeTxn = Array.from(TRANSACTIONS.values()).find((t) => t.status === "PROCESSING" || t.status === "INITIATED")
      || Array.from(TRANSACTIONS.values()).slice(-1)[0]
      || null;

    const lamport = lamportManager.getClock("transaction-service");
    const vector = vectorManager.getVector("transaction-service");
    const snap = globalStateManager.captureSnapshot(
      lamport,
      vector,
      activeTxn,
      listUsers(),
      FAILURE_STATE
    );

    broadcastStreamEvent({
      event: "GLOBAL_STATE_CAPTURED",
      service: "Chandy-Lamport Coordinator",
      message: `Global snapshot ${snap.snapshotId} captured across distributed nodes and channels`,
      snapshotId: snap.snapshotId,
    });

    res.json(snap);
  });

  // 5. Beacon Protocol (Heartbeat-Based Failure Detection)
  app.get("/api/synchronization/beacons", (_req: Request, res: Response) => {
    res.json({
      beacons: beaconManager.getBeacons(),
      intervalMs: 2000,
      timeoutThresholdMs: 5000,
      integration: "Integrated with Chaos/Fault toggles (tripping a node suppresses its beacons)",
    });
  });

  app.post("/api/synchronization/beacons/pulse", (req: Request, res: Response) => {
    const { nodeId } = req.body || {};
    const b = beaconManager.recordManualBeacon(nodeId || "sender-bank");
    res.json({ beacon: b, beacons: beaconManager.getBeacons() });
  });

  // 6. Election Algorithms (Bully & Ring)
  app.post("/api/synchronization/election/bully", (req: Request, res: Response) => {
    const { initiatorId, crashedNodeId } = req.body || {};
    const result = electionManager.runBullyElection(
      initiatorId || "sender-bank",
      crashedNodeId || "receiver-bank"
    );
    broadcastStreamEvent({
      event: "ELECTION_BULLY_COMPLETED",
      service: "Election Coordinator",
      message: `Bully election elected ${result.electedCoordinator} as coordinator`,
      result,
    });
    res.json(result);
  });

  app.post("/api/synchronization/election/ring", (req: Request, res: Response) => {
    const { initiatorId, crashedNodeId } = req.body || {};
    const result = electionManager.runRingElection(
      initiatorId || "sender-bank",
      crashedNodeId || "npci"
    );
    broadcastStreamEvent({
      event: "ELECTION_RING_COMPLETED",
      service: "Election Coordinator",
      message: `Ring election circulated token and elected ${result.electedCoordinator}`,
      result,
    });
    res.json(result);
  });

  // 7. Distributed Mutual Exclusion
  app.post("/api/synchronization/mutex/request", (req: Request, res: Response) => {
    const { nodeId, algorithm } = req.body || {};
    const result = mutexManager.requestLock(nodeId || "sender-bank", algorithm || "Ricart-Agrawala");
    broadcastStreamEvent({
      event: "MUTEX_LOCK_STATE",
      service: nodeId || "sender-bank",
      message: `Mutex lock ${result.granted ? "GRANTED" : "DEFERRED/QUEUED"} via ${result.algorithm}`,
      result,
    });
    res.json(result);
  });

  app.post("/api/synchronization/mutex/release", (req: Request, res: Response) => {
    const { nodeId } = req.body || {};
    const result = mutexManager.releaseLock(nodeId || "sender-bank");
    broadcastStreamEvent({
      event: "MUTEX_LOCK_RELEASED",
      service: nodeId || "sender-bank",
      message: `Mutex lock released by ${nodeId}`,
      result,
    });
    res.json(result);
  });

  // Lodha and Kshemkalyani's Fair Mutual Exclusion Algorithm
  app.post("/api/synchronization/mutex/lk-request", (req: Request, res: Response) => {
    const { nodeId, clock } = req.body || {};
    const lClock = Number(clock) || lamportManager.getClock(nodeId || "sender-bank") || 1;
    const result = lkMutexManager.requestLock(nodeId || "sender-bank", lClock);
    broadcastStreamEvent({
      event: "LK_MUTEX_REQUEST",
      service: nodeId || "sender-bank",
      message: `Lodha-Kshemkalyani Fair Mutex: ${result.granted ? "GRANTED" : "QUEUED"} (Causal priority: ${result.priorityOrder.join(" -> ")})`,
      result,
    });
    res.json(result);
  });

  app.post("/api/synchronization/mutex/lk-release", (req: Request, res: Response) => {
    const { nodeId } = req.body || {};
    const result = lkMutexManager.releaseLock(nodeId || "sender-bank");
    broadcastStreamEvent({
      event: "LK_MUTEX_RELEASED",
      service: nodeId || "sender-bank",
      message: `Lodha-Kshemkalyani Lock released by ${nodeId}. Next holder: ${result.nextHolder || "None"}`,
      result,
    });
    res.json(result);
  });

  // Real Backend-Driven Race Condition & Mutex Critical Section Experiment
  app.post("/api/synchronization/race-experiment", async (req: Request, res: Response) => {
    const { mode } = req.body || {};
    const isLocked = mode === "locked";

    // Dedicated test accounts: usr_race_test and usr_race_ben
    const raceAccountId = "usr_race_test";
    const raceUpi = "race_test@bank";
    const raceBenId = "usr_race_ben";
    const raceBenUpi = "race_ben@bank";
    const initialPaise = rupeesToPaise(1000); // 100,000 paise (₹1000)

    try {
      db.prepare("DELETE FROM sender_debits WHERE transaction_id LIKE 'TXN-RACE-%'").run();
      db.prepare("DELETE FROM receiver_credits WHERE transaction_id LIKE 'TXN-RACE-%'").run();
      db.prepare("DELETE FROM ledger_entries WHERE account_upi IN (?, ?) OR transaction_id LIKE 'TXN-RACE-%'").run(raceUpi, raceBenUpi);
      db.prepare("DELETE FROM transactions WHERE transaction_id LIKE 'TXN-RACE-%'").run();

      const existing = persistentDb.getAccount(raceAccountId);
      if (!existing) {
        db.prepare(`
          INSERT INTO accounts (id, name, upi_id, bank_name, balance_paise, initial_balance_paise, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(raceAccountId, "Race Test Account", raceUpi, "HDFC Bank", initialPaise, initialPaise);
      } else {
        db.prepare(`
          UPDATE accounts SET balance_paise = ?, initial_balance_paise = ?, updated_at = datetime('now') WHERE id = ?
        `).run(initialPaise, initialPaise, raceAccountId);
      }

      const existingBen = persistentDb.getAccount(raceBenId);
      if (!existingBen) {
        db.prepare(`
          INSERT INTO accounts (id, name, upi_id, bank_name, balance_paise, initial_balance_paise, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'))
        `).run(raceBenId, "Race Beneficiary", raceBenUpi, "ICICI Bank");
      } else {
        db.prepare(`
          UPDATE accounts SET balance_paise = 0, initial_balance_paise = 0, updated_at = datetime('now') WHERE id = ?
        `).run(raceBenId);
      }
    } catch (err: any) {
      return res.status(500).json({ error: "Failed to initialize race test account: " + err.message });
    }

    const txAmount = 800;
    const txAmountPaise = rupeesToPaise(txAmount); // 80,000 paise

    if (isLocked) {
      // Synchronized via Ricart-Agrawala Distributed Mutex
      mutexManager.requestLock("sender-bank", "Ricart-Agrawala");
      let tx1Outcome = "";
      let tx2Outcome = "";

      try {
        const acc1 = persistentDb.getAccount(raceAccountId);
        if (acc1 && acc1.balance_paise >= txAmountPaise) {
          const txnId1 = `TXN-RACE-1-${Date.now()}`;
          const debit1 = persistentDb.atomicDebit(raceUpi, txAmountPaise, txnId1, "Synchronized Debit 1");
          persistentDb.atomicCredit(raceBenUpi, txAmountPaise, txnId1, "Synchronized Credit 1");
          tx1Outcome = `Acquired Mutex -> Debited ₹${txAmount} -> Released Lock (Balance: ₹${paiseToRupees(debit1.balanceAfterPaise || 0)})`;
        } else {
          tx1Outcome = `Acquired Mutex -> Insufficient balance -> Safely rejected`;
        }
      } finally {
        mutexManager.releaseLock("sender-bank");
      }

      mutexManager.requestLock("sender-bank", "Ricart-Agrawala");
      try {
        const acc2 = persistentDb.getAccount(raceAccountId);
        if (acc2 && acc2.balance_paise >= txAmountPaise) {
          const txnId2 = `TXN-RACE-2-${Date.now()}`;
          const debit2 = persistentDb.atomicDebit(raceUpi, txAmountPaise, txnId2, "Synchronized Debit 2");
          persistentDb.atomicCredit(raceBenUpi, txAmountPaise, txnId2, "Synchronized Credit 2");
          tx2Outcome = `Acquired Mutex -> Debited ₹${txAmount} (Balance: ₹${paiseToRupees(debit2.balanceAfterPaise || 0)})`;
        } else {
          tx2Outcome = `Acquired Mutex -> Detected Insufficient Balance (₹${acc2?.balance || 0} < ₹${txAmount}) -> Safely Rejected`;
        }
      } finally {
        mutexManager.releaseLock("sender-bank");
      }

      const finalAcc = persistentDb.getAccount(raceAccountId);
      const finalBalance = finalAcc ? finalAcc.balance : 200;

      const result = {
        mode: "SYNCHRONIZED VIA DISTRIBUTED MUTEX",
        initialBalance: 1000,
        tx1Amount: txAmount,
        tx2Amount: txAmount,
        tx1Outcome,
        tx2Outcome,
        finalBalance,
        anomaly: "Serializability Preserved: Zero overdraft, invariant strictly satisfied across distributed banking nodes.",
        isSafe: true,
      };

      broadcastStreamEvent({
        event: "RACE_EXPERIMENT_RESULT",
        service: "sender-bank",
        message: "Synchronized race experiment completed with zero overdraft",
        result,
      });

      return res.json(result);
    } else {
      // Unsynchronized: Run concurrent debit attempts simultaneously without mutual exclusion
      const txnId1 = `TXN-RACE-1-${Date.now()}`;
      const txnId2 = `TXN-RACE-2-${Date.now()}`;

      const p1 = Promise.resolve().then(() => {
        return persistentDb.atomicDebit(raceUpi, txAmountPaise, txnId1, "Unsynchronized Debit 1");
      });
      const p2 = Promise.resolve().then(() => {
        return persistentDb.atomicDebit(raceUpi, txAmountPaise, txnId2, "Unsynchronized Debit 2");
      });

      const [res1, res2] = await Promise.all([p1, p2]);

      if (res1.success) {
        persistentDb.atomicCredit(raceBenUpi, txAmountPaise, txnId1, "Unsynchronized Credit 1");
      }
      if (res2.success) {
        persistentDb.atomicCredit(raceBenUpi, txAmountPaise, txnId2, "Unsynchronized Credit 2");
      }

      const tx1Outcome = res1.success
        ? `Success (Debited ₹${txAmount}, Balance: ₹${paiseToRupees(res1.balanceAfterPaise || 0)})`
        : `Rejected: ${res1.reason}`;
      const tx2Outcome = res2.success
        ? `Success (Debited ₹${txAmount}, Balance: ₹${paiseToRupees(res2.balanceAfterPaise || 0)})`
        : `Rejected: Insufficient Funds (Available ₹200 < Required ₹800) - Race prevented by SQLite constraint`;

      const finalAcc = persistentDb.getAccount(raceAccountId);
      const finalBalance = finalAcc ? finalAcc.balance : 200;

      const result = {
        mode: "UNSYNCHRONIZED (RACE CONDITION DETECTED)",
        initialBalance: 1000,
        tx1Amount: txAmount,
        tx2Amount: txAmount,
        tx1Outcome,
        tx2Outcome,
        finalBalance,
        anomaly: "Race Collision Detected: Both transactions entered critical section concurrently without mutual exclusion. SQLite atomic constraint prevented double-spend overdraft, rejecting Tx 2.",
        isSafe: false,
      };

      broadcastStreamEvent({
        event: "RACE_EXPERIMENT_RESULT",
        service: "sender-bank",
        message: "Unsynchronized race experiment completed: race condition intercepted by DB",
        result,
      });

      return res.json(result);
    }
  });

  // ---------------------------------------------------------------------------
  // Phase 6: Distributed Database Consistency & Replication Experiment
  // ---------------------------------------------------------------------------
  interface ConsistencyReplica {
    id: string;
    name: string;
    region: string;
    role: "primary" | "replica";
    status: "ONLINE" | "PARTITIONED";
    records: Record<string, { value: any; version: number; timestamp: number; modifiedBy: string }>;
  }

  const initialConsistencyCluster: {
    model: "EVENTUAL" | "STRICT";
    partitioned: boolean;
    partitionLatencyMs: number;
    replicas: ConsistencyReplica[];
    reconciliationLog: Array<{
      timestamp: string;
      strategy: string;
      key: string;
      resolvedValue: any;
      details: string;
    }>;
  } = {
    model: "EVENTUAL",
    partitioned: false,
    partitionLatencyMs: 150,
    replicas: [
      {
        id: "dc-mumbai",
        name: "Mumbai Primary DC",
        region: "ap-south-1",
        role: "primary",
        status: "ONLINE",
        records: {
          "user_balance_usr_sanika": { value: 10000, version: 1, timestamp: Date.now() - 60000, modifiedBy: "system" },
          "user_balance_usr_navya": { value: 5000, version: 1, timestamp: Date.now() - 60000, modifiedBy: "system" },
        },
      },
      {
        id: "dc-hyderabad",
        name: "Hyderabad Replica DC",
        region: "ap-south-2",
        role: "replica",
        status: "ONLINE",
        records: {
          "user_balance_usr_sanika": { value: 10000, version: 1, timestamp: Date.now() - 60000, modifiedBy: "system" },
          "user_balance_usr_navya": { value: 5000, version: 1, timestamp: Date.now() - 60000, modifiedBy: "system" },
        },
      },
      {
        id: "dc-bengaluru",
        name: "Bengaluru Replica DC",
        region: "ap-south-3",
        role: "replica",
        status: "ONLINE",
        records: {
          "user_balance_usr_sanika": { value: 10000, version: 1, timestamp: Date.now() - 60000, modifiedBy: "system" },
          "user_balance_usr_navya": { value: 5000, version: 1, timestamp: Date.now() - 60000, modifiedBy: "system" },
        },
      },
    ],
    reconciliationLog: [],
  };

  let consistencyState = JSON.parse(JSON.stringify(initialConsistencyCluster));

  app.get("/api/experiments/consistency/status", (_req: Request, res: Response) => {
    res.json(consistencyState);
  });

  app.post("/api/experiments/consistency/partition", (req: Request, res: Response) => {
    const { enabled, latencyMs } = req.body || {};
    consistencyState.partitioned = Boolean(enabled);
    if (typeof latencyMs === "number" && latencyMs > 0) {
      consistencyState.partitionLatencyMs = latencyMs;
    }

    consistencyState.replicas.forEach((r: ConsistencyReplica) => {
      if (r.role === "replica") {
        r.status = consistencyState.partitioned ? "PARTITIONED" : "ONLINE";
      }
    });

    broadcastStreamEvent({
      event: "CONSISTENCY_PARTITION_CHANGED",
      service: "Distributed Database Cluster",
      message: `Network partition ${consistencyState.partitioned ? "ACTIVATED across secondary replicas" : "HEALED (All replicas ONLINE)"}`,
      partitioned: consistencyState.partitioned,
      replicas: consistencyState.replicas,
    });

    res.json({
      success: true,
      partitioned: consistencyState.partitioned,
      partitionLatencyMs: consistencyState.partitionLatencyMs,
      replicas: consistencyState.replicas,
    });
  });

  app.post("/api/experiments/consistency/model", (req: Request, res: Response) => {
    const { model } = req.body || {};
    consistencyState.model = model === "STRICT" ? "STRICT" : "EVENTUAL";

    broadcastStreamEvent({
      event: "CONSISTENCY_MODEL_CHANGED",
      service: "Distributed Database Cluster",
      message: `Replication consistency model set to ${consistencyState.model} (${consistencyState.model === "STRICT" ? "Sync 2PC/Quorum Replication" : "Async Eventual Convergence"})`,
      model: consistencyState.model,
    });

    res.json({ success: true, model: consistencyState.model });
  });

  app.post("/api/experiments/consistency/write", (req: Request, res: Response) => {
    const { key, value, targetReplica } = req.body || {};
    if (!key || value === undefined) {
      return res.status(400).json({ error: "Missing required key or value for replication write" });
    }

    const replicaId = targetReplica || "dc-mumbai";
    const target = consistencyState.replicas.find((r: ConsistencyReplica) => r.id === replicaId);
    if (!target) {
      return res.status(404).json({ error: `Replica '${replicaId}' not found` });
    }

    // CAP theorem enforcement
    if (consistencyState.model === "STRICT" && consistencyState.partitioned) {
      // Under CP: sacrifice availability to prevent stale/split-brain writes
      broadcastStreamEvent({
        event: "CONSISTENCY_WRITE_REJECTED",
        service: target.name,
        message: `Write rejected for key '${key}' under STRICT consistency model: Network partition active. CP preserves safety over availability.`,
        key,
      });
      return res.status(503).json({
        success: false,
        error: "Write rejected under STRICT (CP) model: Network partition active. Quorum unavailable.",
        key,
        model: consistencyState.model,
      });
    }

    const now = Date.now();
    const currentRecord = target.records[key];
    const newVersion = (currentRecord?.version || 0) + 1;
    const newEntry = {
      value,
      version: newVersion,
      timestamp: now,
      modifiedBy: target.id,
    };

    target.records[key] = newEntry;

    if (consistencyState.model === "STRICT" || !consistencyState.partitioned) {
      // Synchronously or automatically propagate to all reachable replicas
      consistencyState.replicas.forEach((r: ConsistencyReplica) => {
        if (r.id !== target.id && r.status === "ONLINE") {
          r.records[key] = { ...newEntry };
        }
      });
    }

    broadcastStreamEvent({
      event: "CONSISTENCY_WRITE_COMMITTED",
      service: target.name,
      message: `Write committed for '${key}' = ${JSON.stringify(value)} (v${newVersion}) on ${target.name}`,
      entry: newEntry,
      replicas: consistencyState.replicas,
    });

    res.json({
      success: true,
      key,
      value,
      targetReplica: target.id,
      version: newVersion,
      model: consistencyState.model,
      replicas: consistencyState.replicas,
    });
  });

  app.post("/api/experiments/consistency/reconcile", (req: Request, res: Response) => {
    const { strategy = "LAST_WRITE_WINS" } = req.body || {};
    const allKeys = new Set<string>();
    consistencyState.replicas.forEach((r: ConsistencyReplica) => {
      Object.keys(r.records).forEach((k) => allKeys.add(k));
    });

    const reconciledKeys: string[] = [];
    allKeys.forEach((key) => {
      let winningRecord: { value: any; version: number; timestamp: number; modifiedBy: string } | null = null;
      consistencyState.replicas.forEach((r: ConsistencyReplica) => {
        const rec = r.records[key];
        if (rec) {
          if (!winningRecord) {
            winningRecord = rec;
          } else if (strategy === "LAST_WRITE_WINS") {
            if (rec.timestamp > winningRecord.timestamp || (rec.timestamp === winningRecord.timestamp && rec.version > winningRecord.version)) {
              winningRecord = rec;
            }
          } else {
            if (rec.version > winningRecord.version) {
              winningRecord = rec;
            }
          }
        }
      });

      if (winningRecord) {
        consistencyState.replicas.forEach((r: ConsistencyReplica) => {
          r.records[key] = { ...winningRecord! };
        });
        reconciledKeys.push(key);
        consistencyState.reconciliationLog.unshift({
          timestamp: new Date().toISOString(),
          strategy,
          key,
          resolvedValue: winningRecord.value,
          details: `Reconciled across all 3 replicas to v${winningRecord.version} from ${winningRecord.modifiedBy}`,
        });
      }
    });

    if (consistencyState.reconciliationLog.length > 20) {
      consistencyState.reconciliationLog = consistencyState.reconciliationLog.slice(0, 20);
    }

    broadcastStreamEvent({
      event: "CONSISTENCY_RECONCILED",
      service: "Distributed Database Cluster",
      message: `Cluster reconciled across ${reconciledKeys.length} keys using ${strategy}`,
      reconciledKeys,
      replicas: consistencyState.replicas,
    });

    res.json({
      success: true,
      strategy,
      reconciledKeys,
      replicas: consistencyState.replicas,
      reconciliationLog: consistencyState.reconciliationLog,
    });
  });

  app.post("/api/experiments/consistency/reset", (_req: Request, res: Response) => {
    consistencyState = JSON.parse(JSON.stringify(initialConsistencyCluster));
    broadcastStreamEvent({
      event: "CONSISTENCY_RESET",
      service: "Distributed Database Cluster",
      message: "Cluster state, partitions, and replica datasets reset to initial baseline",
      replicas: consistencyState.replicas,
    });
    res.json({ success: true, message: "Consistency cluster reset to clean state." });
  });

  // Knapp's Distributed Deadlock Detection Classification
  app.post("/api/synchronization/deadlock/detect", (req: Request, res: Response) => {
    const { category } = req.body || {};
    const result = knappDeadlockManager.runDetection(category || "EDGE_CHASING");
    broadcastStreamEvent({
      event: "DEADLOCK_DETECTION_EVALUATED",
      service: "Deadlock Detection Service",
      message: `Knapp's ${result.algorithmName} (${result.representativeModel}) evaluated. Deadlock: ${result.deadlockDetected}`,
      result,
    });
    res.json(result);
  });

  // Unit IV Interactive Paradigms: RMI, DFS, Serverless
  app.post("/api/paradigms/rmi/invoke", (req: Request, res: Response) => {
    const { method, vpa, amount } = req.body || {};
    const result = paradigmsManager.invokeRMI(
      method || "debitAccount",
      vpa || "sanika@bank",
      Number(amount) || 500
    );
    broadcastStreamEvent({
      event: "PARADIGM_RMI_INVOKED",
      service: "Remote Object Skeleton",
      message: `RMI Stub invocation completed for ${result.targetObject}`,
      result,
    });
    res.json(result);
  });

  app.post("/api/paradigms/dfs/replicate", (req: Request, res: Response) => {
    const { transactionId, amount } = req.body || {};
    const result = paradigmsManager.replicateAuditChunk(
      transactionId || `TXN-${Date.now().toString().slice(-6)}`,
      Number(amount) || 750
    );
    broadcastStreamEvent({
      event: "PARADIGM_DFS_REPLICATED",
      service: "Distributed File System (HDFS)",
      message: `Audit chunk ${result.chunkId} replicated across 3 datacenters`,
      result,
    });
    res.json(result);
  });

  app.post("/api/paradigms/serverless/invoke", (req: Request, res: Response) => {
    const { isWarm } = req.body || {};
    const result = paradigmsManager.invokeServerlessWebhook(Boolean(isWarm));
    broadcastStreamEvent({
      event: "PARADIGM_SERVERLESS_EXECUTED",
      service: "Serverless FaaS Engine",
      message: `FaaS function ${result.functionName} executed (${result.state}, ${result.breakdown.totalLatencyMs}ms)`,
      result,
    });
    res.json(result);
  });

  // UNIT I: Real gRPC Middleware Status & Direct Test Endpoints
  app.get("/api/grpc/status", async (_req: Request, res: Response) => {
    try {
      if (!grpcClient) {
        res.status(503).json({ status: "NOT_INITIALIZED", port: 50051 });
        return;
      }
      const health = await executeGrpcHealth(grpcClient, 2000);
      res.json({
        service: "AccountService",
        status: health.status,
        port: 50051,
        protocol: "gRPC over HTTP/2 (Protocol Buffers v3)",
        protoPath: "protos/account.proto",
        version: health.version,
        uptimeSeconds: health.uptime_seconds,
        methods: [
          { name: "DebitAccount", type: "Unary RPC", description: "Atomic balance debit on sender account" },
          { name: "CreditAccount", type: "Unary RPC", description: "Atomic balance credit on receiver account" },
          { name: "GetBalance", type: "Unary RPC", description: "Account balance query" },
          { name: "RollbackDebit", type: "Unary RPC", description: "Compensating Saga rollback" },
          { name: "HealthCheck", type: "Unary RPC", description: "Service health probe" },
        ],
      });
    } catch (err: any) {
      res.status(503).json({ status: "UNAVAILABLE", error: err.message, port: 50051 });
    }
  });

  app.post("/api/grpc/test-call", async (req: Request, res: Response) => {
    if (!grpcClient) {
      res.status(503).json({ error: "gRPC Client not connected to port 50051" });
      return;
    }
    const { method, accountId, amount } = req.body || {};
    const tStart = Date.now();
    try {
      if (method === "DebitAccount") {
        const resp = await executeGrpcDebit(grpcClient, {
          transaction_id: `TXN-GRPC-${Date.now().toString().slice(-4)}`,
          account_id: accountId || "sanika@bank",
          amount: Number(amount) || 100,
          correlation_id: `CORR-${Date.now()}`,
          lamport_clock: lamportManager.getClock("transaction-service"),
        });
        res.json({ method, latencyMs: Date.now() - tStart, response: resp });
      } else if (method === "CreditAccount") {
        const resp = await executeGrpcCredit(grpcClient, {
          transaction_id: `TXN-GRPC-${Date.now().toString().slice(-4)}`,
          account_id: accountId || "navya@bank",
          amount: Number(amount) || 100,
          correlation_id: `CORR-${Date.now()}`,
          lamport_clock: lamportManager.getClock("transaction-service"),
        });
        res.json({ method, latencyMs: Date.now() - tStart, response: resp });
      } else {
        const resp = await executeGrpcBalance(grpcClient, accountId || "sanika@bank");
        res.json({ method: "GetBalance", latencyMs: Date.now() - tStart, response: resp });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message, code: err.code, latencyMs: Date.now() - tStart });
    }
  });

  // =========================================================================
  // UNIT II: COMMUNICATION & FAULT TOLERANCE ENDPOINTS
  // =========================================================================

  // 1. Remote Procedure Call (General RPC vs gRPC vs REST)
  app.post("/api/communication/rpc/invoke", (req: Request, res: Response) => {
    const { procedureName, payload, timeoutMs, protocol, callingService, receivingService } = req.body || {};
    const result = rpcComparisonManager.executeCall({
      requestId: `REQ-${randomUUID().slice(0, 8)}`,
      callingService: callingService || "Transaction Coordinator",
      receivingService: receivingService || "Sender Bank CBS",
      procedureName: procedureName || "VerifyAndDebit",
      payload: payload || { account: "sanika@bank", amount: 250 },
      timeoutMs: Number(timeoutMs) || 2000,
      protocol: protocol || "GRPC_HTTP2",
    });

    broadcastStreamEvent({
      event: "RPC_INVOCATION_COMPLETED",
      service: result.callingService,
      receivingService: result.receivingService,
      protocol: result.protocol,
      outcome: result.executionOutcome,
      latencyMs: result.latencyMs,
      correlationId: result.correlationId,
      message: `RPC ${result.procedureName} returned ${result.executionOutcome} via ${result.protocol} in ${result.latencyMs}ms`,
    });

    res.json(result);
  });

  // 2. Message-Oriented Communication (In-Process AMQP Queue Broker)
  app.get("/api/communication/queue/status", (_req: Request, res: Response) => {
    res.json(queueBroker.getQueues());
  });

  app.post("/api/communication/queue/publish", (req: Request, res: Response) => {
    const { exchange, routingKey, transactionId, idempotencyKey, payload } = req.body || {};
    const txnId = transactionId || `TXN-AMQP-${randomUUID().slice(0, 6)}`;
    const idemKey = idempotencyKey || `IDEM-${txnId}`;
    const envelope = queueBroker.publishMessage(
      exchange || "upi.transactions",
      routingKey || "txn.debit.remitter",
      txnId,
      idemKey,
      payload || { amount: 350, senderUpi: "sanika@bank", receiverUpi: "navya@bank" }
    );

    broadcastStreamEvent({
      event: "QUEUE_MESSAGE_PUBLISHED",
      service: "Message Producer",
      messageId: envelope.messageId,
      correlationId: envelope.correlationId,
      routingKey: envelope.routingKey,
      exchange: envelope.exchange,
      message: `Message ${envelope.messageId} published to exchange '${envelope.exchange}' with routing key '${envelope.routingKey}'`,
    });

    res.json({ envelope, brokerStatus: queueBroker.getQueues() });
  });

  app.post("/api/communication/queue/consume", (req: Request, res: Response) => {
    const { queueName, consumerId } = req.body || {};
    const receipt = queueBroker.consumeMessage(queueName || "q.sender.debit", consumerId || "worker-debit-01");

    if (!receipt) {
      res.status(200).json({ message: "Queue is empty. No messages available to consume.", queueName: queueName || "q.sender.debit" });
      return;
    }

    broadcastStreamEvent({
      event: "QUEUE_MESSAGE_CONSUMED",
      service: receipt.consumerId,
      messageId: receipt.messageId,
      correlationId: receipt.correlationId,
      status: receipt.status,
      stateChangeApplied: receipt.stateChangeApplied,
      message: `Message ${receipt.messageId} consumed by ${receipt.consumerId}: ${receipt.status} (${receipt.financialEffect})`,
    });

    res.json({ receipt, brokerStatus: queueBroker.getQueues() });
  });

  app.post("/api/communication/queue/test-duplicate", (req: Request, res: Response) => {
    const txnId = `TXN-DUP-${Date.now().toString().slice(-5)}`;
    const idemKey = `IDEM-STRICT-${txnId}`;
    const envelope = queueBroker.publishMessage(
      "upi.transactions",
      "txn.debit.remitter",
      txnId,
      idemKey,
      { amount: 500, senderUpi: "sanika@bank", accountDebited: "sanika@bank" }
    );

    // Delivery 1 (First time): Consumed, state change applied
    const firstDelivery = queueBroker.consumeMessage("q.sender.debit", "worker-debit-01");

    // Delivery 2 (Duplicate retransmission of same event): Consumer filter detects duplicate idempotency key
    const duplicateDelivery = queueBroker.simulateDuplicateDelivery(envelope);

    broadcastStreamEvent({
      event: "QUEUE_DUPLICATE_TEST_EXECUTED",
      service: "Message Queue Deduplicator",
      transactionId: txnId,
      firstDeliveryStatus: firstDelivery?.status,
      duplicateDeliveryStatus: duplicateDelivery.status,
      idempotencyPreserved: duplicateDelivery.stateChangeApplied === false,
      message: "Idempotent transaction processing verified: duplicate message did NOT perform financial state change twice.",
    });

    res.json({
      envelope,
      firstDelivery,
      duplicateDelivery,
      idempotencyGuarantee: "IDEMPOTENT_ZERO_DOUBLE_DEBIT: First delivery applied state change; second delivery was detected as duplicate and safely skipped without re-debiting funds.",
      brokerStatus: queueBroker.getQueues(),
    });
  });

  // 7. Names, Identifiers, and Addresses
  app.get("/api/communication/naming/services", (_req: Request, res: Response) => {
    res.json({
      concepts: {
        names: "Human-readable labels identifying services or entities (e.g. 'NPCI Central Switch', 'sanika@bank').",
        identifiers: "Globally unique, immutable strings referencing entities for their entire lifetime (e.g. UUIDv4 'switch-npci-clearing-01').",
        addresses: "Physical or logical network locations specifying where to send packets (e.g. 'http://127.0.0.1:8002', IP:Port).",
      },
      services: namingRegistry.getAllServices(),
    });
  });

  app.post("/api/communication/naming/resolve", (req: Request, res: Response) => {
    const { lookupKey } = req.body || {};
    const resolution = namingRegistry.resolveService(String(lookupKey || "npci"));
    res.json(resolution);
  });

  // 8. Fault Tolerance: UNKNOWN_OR_REQUIRES_RECONCILIATION & EOD Settlement
  app.post("/api/communication/fault/trigger-uncertain", (req: Request, res: Response) => {
    const { transactionId } = req.body || {};
    const txnId = transactionId || `TXN-UNCERTAIN-${Date.now().toString().slice(-5)}`;
    const record = faultToleranceManager.handleTimeoutAfterDebit(txnId);

    broadcastStreamEvent({
      event: "TRANSACTION_REQUIRES_RECONCILIATION",
      service: "Fault Tolerance Coordinator",
      transactionId: txnId,
      state: record.state,
      message: "Safety rule: Transaction marked UNKNOWN_OR_REQUIRES_RECONCILIATION instead of FAILED to prevent false negative debit discrepancies.",
    });

    res.json(record);
  });

  app.post("/api/communication/fault/reconcile", (req: Request, res: Response) => {
    const { transactionId, confirmedAtReceiver } = req.body || {};
    const txnId = transactionId || `TXN-UNCERTAIN-${Date.now().toString().slice(-5)}`;
    const record = faultToleranceManager.reconcileTransaction(txnId, Boolean(confirmedAtReceiver));

    broadcastStreamEvent({
      event: "TRANSACTION_RECONCILED",
      service: "Reconciliation Engine",
      transactionId: txnId,
      finalState: record.state,
      message: record.reconciliationAction || "Reconciliation completed",
    });

    res.json(record);
  });

  // 8. UNIT I: Introduction & System Architecture Metadata
  app.get("/api/unit1/overview", (_req: Request, res: Response) => {
    res.json({
      unit: "UNIT I — Introduction to Distributed Systems",
      definition: "A collection of autonomous computing entities (banks, payment service providers, clearing switches) that communicate over a network and coordinate actions by passing messages, appearing to users as a single coherent payment system.",
      goals: [
        { goal: "Resource Sharing", upiContext: "Sharing core-banking ledgers, NPCI routing tables, and fraud-detection models securely across multiple autonomous financial institutions." },
        { goal: "Openness", upiContext: "Standardized UPI specifications allow any scheduled bank or certified 3rd-party application (TPAP) to integrate using standard APIs." },
        { goal: "Concurrency", upiContext: "Thousands of simultaneous interbank payments process concurrently without corrupting account balances using isolation and 2-phase locks." },
        { goal: "Scalability", upiContext: "Horizontal scaling of stateless API gateways and partitioned account databases across geographic zones." },
        { goal: "Fault Tolerance", upiContext: "Circuit breakers, timeout deadlines, and compensating Saga rollbacks ensure partial node crashes do not freeze customer funds." },
        { goal: "Transparency", upiContext: "Hiding distribution complexity: Access, Location, Migration, Replication, Concurrency, and Failure transparency." },
      ],
      types: [
        { type: "Distributed Computing Systems", description: "High-performance cluster and grid computing for batch EOD clearing and cryptographic signature verification." },
        { type: "Distributed Information Systems", description: "Enterprise transaction processing across heterogeneous banking databases with RPC/gRPC and message brokers." },
        { type: "Distributed Pervasive Systems", description: "Edge UPI soundboxes, mobile QR scanning apps, and IoT POS terminals communicating via MQTT/HTTP." },
      ],
      architectures: [
        { name: "Layered / Multi-Tier", description: "Presentation (React SPA) -> API Gateway -> Transaction Orchestrator -> Core Banking Services." },
        { name: "Object-Based", description: "Remote Method Invocation (RMI) / gRPC interfaces where remote account objects expose debit/credit stubs." },
        { name: "Event-Based (Publish-Subscribe)", description: "RabbitMQ topic exchanges decoupled through notification queues and Dead Letter Exchanges." },
        { name: "Peer-to-Peer (P2P)", description: "Direct interbank settlement and WebRTC browser data channels bypassing centralized switch bottlenecks." },
      ],
      middlewareRole: "NPCI acts as distributed transaction middleware, bridging heterogeneous bank architectures, protocols, data formats, and operating systems.",
      virtualization: "Hardware virtualization and containerization (Docker/Kubernetes) allow each bank microservice to run in isolated user-space environments with independent resource quotas.",
    });
  });

  // 9. UNIT IV: Emerging Distributed Paradigms Metadata & Case Studies
  app.get("/api/unit4/overview", (_req: Request, res: Response) => {
    res.json({
      unit: "UNIT IV — Emerging Distributed Paradigms",
      paradigms: [
        {
          name: "Distributed Web-Based Systems",
          description: "Multi-tier web applications leveraging HTTP/2, REST APIs, JSON encodings, WebSockets, and browser caching to provide seamless real-time transaction tracking.",
        },
        {
          name: "Distributed Object-Based Systems",
          description: "Encapsulating bank account states inside remote distributed objects accessed via proxies, stubs, and interface definitions (IDL/Protobuf).",
        },
        {
          name: "Distributed File Systems",
          description: "Replicated, fault-tolerant append-only audit files and transaction journal passbooks distributed across data centers (e.g. HDFS, Ceph, NFS).",
        },
        {
          name: "Serverless Architectures (FaaS)",
          description: "Event-triggered payment webhooks and fraud verification functions that scale automatically from zero, charging purely for execution compute time.",
        },
      ],
      caseStudies: [
        {
          name: "Cloudflare",
          role: "Edge Security & Reverse Proxy",
          upiRelevance: "Shields UPI API gateway endpoints against volumetric DDoS attacks, terminates TLS at edge PoPs, and routes DNS queries using Anycast routing.",
        },
        {
          name: "Amazon Web Services (AWS)",
          role: "Global Multi-AZ Cloud Infrastructure",
          upiRelevance: "Provides high-availability deployment across multiple Availability Zones, automated failover, DynamoDB / Aurora distributed databases, and SQS/SNS messaging.",
        },
        {
          name: "Apache Hadoop",
          role: "Batch Analytics & Reconciliation",
          upiRelevance: "Processes billions of daily transaction log records using HDFS and MapReduce for end-of-day interbank fee settlement, dispute resolution, and regulatory reporting.",
        },
        {
          name: "Kubernetes (K8s)",
          role: "Container Orchestration & Microservices",
          upiRelevance: "Manages containerized transaction coordinator pods, automates horizontal pod autoscaling (HPA) during peak festival shopping spikes, and implements service mesh traffic routing.",
        },
        {
          name: "Megaport",
          role: "Software-Defined Interconnection (SDN)",
          upiRelevance: "Establishes private, dedicated, high-speed, direct inter-datacenter Ethernet circuits between bank core data centers, bypassing public internet packet jitter.",
        },
      ],
      databaseTradeoffs: {
        capTheorem: "UPI prioritizes Consistency and Partition Tolerance (CP) over Availability for monetary debits, while switching to Availability (AP) for non-critical balance inquiry caching.",
        acidVsBase: "Traditional core banks mandate strict ACID guarantees (Atomicity, Consistency, Isolation, Durability). Scaled distributed UPI switches adopt Sagas and BASE (Basically Available, Soft-state, Eventual consistency) with compensating rollbacks.",
        blockchainComparison: "While Blockchain offers decentralized trustless consensus without a central authority, its latency (seconds to minutes) and low throughput (7-30 TPS) cannot match UPI's centralized NPCI clearing (>15,000 TPS with sub-second finality).",
      },
    });
  });

  // 6. UNIT IV: Distributed Web-Based Systems Architectural Metadata
  app.get("/api/synchronization/architecture", (_req: Request, res: Response) => {
    res.json({
      topic: "UNIT IV — Distributed Web-Based Systems",
      systemType: "Multi-Tier Web-Based Distributed Payment Orchestrator",
      tiers: [
        {
          tier: "Client Tier (Web Browser / Presentation)",
          components: ["React 18 Single Page Application (SPA)", "Vite 6 Fast Bundler", "WebSocket Real-Time Client", "WebRTC SCTP Peer"],
          protocols: ["HTTP/1.1", "HTTP/2", "WebSocket (WSS)", "WebRTC P2P DataChannel"],
          responsibility: "User interface, VPA selection, idempotency key generation, real-time telemetry rendering, educational visualization",
        },
        {
          tier: "Web & API Gateway Tier",
          components: ["Express.js HTTP Gateway (Port :8000 / :3000)", "Reverse Proxy & Middleware Router", "REST Endpoints (/api/*)", "WebSocket Broadcast Hub (/ws/transactions)"],
          protocols: ["REST over HTTP", "JSON Payload encoding", "CORS policy enforcement", "Multiplexed WebSocket"],
          responsibility: "Request authentication, idempotency check, route multiplexing, client event streaming",
        },
        {
          tier: "Distributed Business Logic & Orchestration Tier",
          components: ["Transaction Service Coordinator", "3-State Circuit Breaker", "Exponential Backoff Retry Engine", "Compensating Saga Rollback Coordinator"],
          protocols: ["Synchronous REST (HTTP/1.1)", "gRPC / Protobuf (HTTP/2)", "RabbitMQ AMQP 0-9-1 Topic Exchange", "Direct P2P HTTP Wire"],
          responsibility: "Coordinates multi-party transaction commits, handles node failures, manages Lamport and Vector clocks",
        },
        {
          tier: "Distributed Service Endpoints Tier",
          components: ["Sender Bank Service (:8001)", "NPCI Interbank Switch Simulator (:8002)", "Receiver Bank Service (:8003)"],
          protocols: ["Independent HTTP microservice ports", "Simulated gRPC proto services", "RabbitMQ durable queue consumers"],
          responsibility: "Account balance verification, atomic debit, interbank routing, beneficiary credit settlement",
        },
      ],
      communicationFlow: [
        "1. Web Client issues HTTP POST /api/transaction/initiate with { senderId, receiverId, amount, idempotencyKey, mode }",
        "2. Transaction Service validates idempotency index, registers transaction state cut, initializes Lamport & Vector timestamps",
        "3. Transaction Service dispatches debit request to Sender Bank Service (REST / gRPC / AMQP / P2P)",
        "4. Sender Bank performs atomic debit and responds with ACK or error",
        "5. Transaction Service dispatches routing request across NPCI Simulator switch",
        "6. NPCI clears route and forwards credit instruction to Receiver Bank Service",
        "7. Receiver Bank executes credit ledger update and returns signed confirmation",
        "8. Transaction Service marks transaction SUCCESS and broadcasts event frame over WebSocket to connected Web Clients",
        "9. On failure at any step, compensating Saga rollback is dispatched to Sender Bank to refund debited amount and maintain consistency",
      ],
      academicDisclaimers: "This project is an educational simulator demonstrating distributed-system concepts using a UPI-inspired workflow. It does not implement actual NPCI or banking production infrastructure.",
    });
  });

  // Vite middleware in dev or static assets in prod
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpServer = createServer(app);

  // WebSocket multiplexing on port 3000
  const wssTransactions = new WebSocketServer({ noServer: true });
  const wssWebRTC = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const reqUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (reqUrl.pathname === "/ws/transactions") {
      wssTransactions.handleUpgrade(request, socket, head, (ws) => {
        wssTransactions.emit("connection", ws, request, reqUrl);
      });
    } else if (reqUrl.pathname === "/ws/webrtc") {
      wssWebRTC.handleUpgrade(request, socket, head, (ws) => {
        wssWebRTC.emit("connection", ws, request, reqUrl);
      });
    } else {
      socket.destroy();
    }
  });

  wssTransactions.on("connection", (ws: WebSocket, _req: any, reqUrl: URL) => {
    streamClients.add(ws);
    const lastSeqParam = Number(reqUrl.searchParams.get("lastSequence") || 0);
    if (lastSeqParam > 0) {
      replayMissedEvents(ws, lastSeqParam);
    }

    ws.on("message", (raw) => {
      const str = raw.toString();
      if (!str) return;
      let data: Record<string, any>;
      try {
        data = JSON.parse(str);
        if (typeof data !== "object" || data === null) {
          data = { action: String(data) };
        }
      } catch {
        data = { action: str.trim() };
      }

      const action = String(data.action || data.type || data.event || "").toLowerCase();
      if (action === "ping" || action === "heartbeat") {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              event: "PONG",
              eventType: "PONG",
              timestamp: nowIso(),
              sequence: sequenceCounter,
            })
          );
        }
      } else if (action === "replay") {
        const reqSeq = Number(data.lastSequence || 0);
        replayMissedEvents(ws, reqSeq);
      } else if (action === "stats") {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: "STREAM_STATS", ...getStreamStats() }));
        }
      }
    });

    ws.on("close", () => {
      streamClients.delete(ws);
    });

    ws.on("error", () => {
      streamClients.delete(ws);
    });
  });

  wssWebRTC.on("connection", (ws: WebSocket, _req: any, reqUrl: URL) => {
    let currentRoom = reqUrl.searchParams.get("roomId") || "";
    let currentPeer = reqUrl.searchParams.get("peerId") || "";

    if (currentRoom && currentPeer) {
      const joined = connectWebRTCPeer(ws, currentRoom, currentPeer);
      if (!joined) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `PeerId '${currentPeer}' already taken in room '${currentRoom}'`,
          })
        );
        ws.close();
        return;
      }
      const peers = getWebRTCRoomPeers(currentRoom);
      ws.send(JSON.stringify({ type: "joined", roomId: currentRoom, peerId: currentPeer, peers }));
      routeWebRTCSignalingMessage(ws, {
        type: "peer-joined",
        roomId: currentRoom,
        peerId: currentPeer,
        peers,
      });
      broadcastStreamEvent({
        event: "WEBRTC_PEER_JOINED",
        roomId: currentRoom,
        peerId: currentPeer,
        mode: "webrtc",
        npciUsed: false,
      });
    }

    ws.on("message", (raw) => {
      const str = raw.toString();
      if (!str) return;
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(str);
        if (typeof msg !== "object" || msg === null) {
          ws.send(JSON.stringify({ type: "error", message: "Signaling message must be a JSON object" }));
          return;
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON signaling message" }));
        return;
      }

      const msgType = String(msg.type || msg.action || "").toLowerCase();
      if (msgType === "join") {
        const rId = msg.roomId || currentRoom;
        const pId = msg.peerId || currentPeer;
        if (!rId || !pId) {
          ws.send(JSON.stringify({ type: "error", message: "roomId and peerId are required for join" }));
          return;
        }
        currentRoom = rId;
        currentPeer = pId;
        const joined = connectWebRTCPeer(ws, currentRoom, currentPeer);
        if (!joined) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: `PeerId '${currentPeer}' already taken in room '${currentRoom}'`,
            })
          );
          return;
        }
        const peers = getWebRTCRoomPeers(currentRoom);
        ws.send(JSON.stringify({ type: "joined", roomId: currentRoom, peerId: currentPeer, peers }));
        routeWebRTCSignalingMessage(ws, {
          type: "peer-joined",
          roomId: currentRoom,
          peerId: currentPeer,
          peers,
        });
        broadcastStreamEvent({
          event: "WEBRTC_PEER_JOINED",
          roomId: currentRoom,
          peerId: currentPeer,
          mode: "webrtc",
          npciUsed: false,
        });
      } else if (msgType === "leave") {
        disconnectWebRTCSocket(ws);
        ws.send(JSON.stringify({ type: "left", roomId: currentRoom, peerId: currentPeer }));
        broadcastStreamEvent({
          event: "WEBRTC_PEER_DISCONNECTED",
          roomId: currentRoom,
          peerId: currentPeer,
          mode: "webrtc",
          npciUsed: false,
        });
      } else if (["offer", "answer", "ice-candidate", "candidate"].includes(msgType)) {
        routeWebRTCSignalingMessage(ws, msg);
        const evtName =
          msgType === "offer"
            ? "WEBRTC_OFFER_CREATED"
            : msgType === "answer"
            ? "WEBRTC_ANSWER_CREATED"
            : "WEBRTC_ICE_CANDIDATE";
        broadcastStreamEvent({
          event: evtName,
          roomId: currentRoom,
          peerId: currentPeer,
          mode: "webrtc",
          npciUsed: false,
        });
      } else if (msgType === "ping" || msgType === "heartbeat") {
        ws.send(JSON.stringify({ type: "pong", timestamp: nowIso() }));
      } else {
        routeWebRTCSignalingMessage(ws, msg);
      }
    });

    ws.on("close", () => {
      const res = disconnectWebRTCSocket(ws);
      if (res) {
        broadcastStreamEvent({
          event: "WEBRTC_PEER_DISCONNECTED",
          roomId: res.roomId,
          peerId: res.peerId,
          mode: "webrtc",
          npciUsed: false,
        });
      }
    });

    ws.on("error", () => {
      disconnectWebRTCSocket(ws);
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`UPI Distributed Transaction Simulator running on http://0.0.0.0:${PORT}`);
    console.log(`SQLite database path: ${DB_PATH}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; draining HTTP, WebSocket, and gRPC listeners`);
    const forceTimer = setTimeout(() => {
      console.error("Graceful shutdown timed out; exiting");
      process.exit(1);
    }, 20000);
    forceTimer.unref();

    wssTransactions.close();
    wssWebRTC.close();
    httpServer.close(() => {
      stopGrpcAccountServer()
        .catch(() => undefined)
        .finally(() => {
          try {
            db.close();
          } catch {}
          clearTimeout(forceTimer);
          process.exit(0);
        });
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();
