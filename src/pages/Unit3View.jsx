import { useEffect, useState, useCallback } from "react";
import PageShell from "../components/layout/PageShell";
import {
  fetchLamportClocks,
  triggerLamportEvent,
  resetLamportClocks,
  requestMutexLock,
  releaseMutexLock,
  requestLKMutexLock,
  releaseLKMutexLock,
  runRaceExperiment,
  fetchConsistencyStatus,
  toggleConsistencyPartition,
  setConsistencyModel,
  writeConsistencyRecord,
  reconcileConsistency,
  resetConsistency,
  connectTransactionSocket,
} from "../api";
import {
  GitCommit,
  Lock,
  ShieldCheck,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  Award,
  Layers,
  ArrowRight,
  Zap,
  AlertTriangle,
  Play,
  Users,
  Database,
  Network,
  Split,
  Radio,
} from "lucide-react";

export default function Unit3View() {
  const [activeTab, setActiveTab] = useState("lamport");
  const [connStatus, setConnStatus] = useState("connecting");

  // 1. Lamport Clocks
  const [lamportNodes, setLamportNodes] = useState([]);
  const [lamportHistory, setLamportHistory] = useState([]);
  const [interceptorData, setInterceptorData] = useState(null);
  const [lamportBusy, setLamportBusy] = useState(false);

  // 2. Mutual Exclusion Baseline (Ricart-Agrawala & Token Ring)
  const [mutexNode, setMutexNode] = useState("sender-bank");
  const [mutexResult, setMutexResult] = useState(null);
  const [mutexBusy, setMutexBusy] = useState(false);

  // 3. Lodha & Kshemkalyani's Fair Mutual Exclusion
  const [lkResult, setLkResult] = useState(null);
  const [lkBusy, setLkBusy] = useState(false);
  const [lkNode, setLkNode] = useState("sender-bank");

  // 4. Race Condition Simulator State
  const [raceRunning, setRaceRunning] = useState(false);
  const [raceMode, setRaceMode] = useState("unlocked"); // 'unlocked' (race) vs 'locked' (synchronized)
  const [raceResult, setRaceResult] = useState(null);

  // 5. Distributed Consistency & Replication State
  const [consistencyData, setConsistencyData] = useState(null);
  const [consistencyBusy, setConsistencyBusy] = useState(false);
  const [writeKey, setWriteKey] = useState("user_balance_usr_sanika");
  const [writeValue, setWriteValue] = useState("9500");
  const [writeTarget, setWriteTarget] = useState("dc-mumbai");
  const [reconcileStrategy, setReconcileStrategy] = useState("LAST_WRITE_WINS");
  const [consistencyFeedback, setConsistencyFeedback] = useState(null);

  const loadConsistency = useCallback(async () => {
    try {
      const data = await fetchConsistencyStatus();
      setConsistencyData(data);
    } catch (e) {
      console.error("Failed to load consistency status:", e);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [lmpRes, cData] = await Promise.all([
        fetchLamportClocks(),
        fetchConsistencyStatus().catch(() => null),
      ]);
      setLamportNodes(lmpRes.clocks || []);
      setLamportHistory(lmpRes.history || []);
      setInterceptorData(lmpRes.interceptor || null);
      if (cData) setConsistencyData(cData);
    } catch (e) {
      console.error("Failed to load Lamport clocks / consistency:", e);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const ws = connectTransactionSocket(() => loadAll(), setConnStatus);
    return () => ws.close();
  }, [loadAll]);

  // Handlers for Lamport Clocks
  async function handleTriggerLamport(type, nodeId, targetNodeId, description) {
    setLamportBusy(true);
    try {
      const res = await triggerLamportEvent({ type, nodeId, targetNodeId, description });
      setLamportNodes(res.clocks || []);
      setLamportHistory(res.history || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLamportBusy(false);
    }
  }

  // Handlers for Mutual Exclusion (Ricart-Agrawala & Token-Ring)
  async function handleMutexRequest(algorithm) {
    setMutexBusy(true);
    try {
      const res = await requestMutexLock(mutexNode, algorithm);
      setMutexResult(res);
    } catch (e) {
      console.error(e);
    } finally {
      setMutexBusy(false);
    }
  }

  async function handleMutexRelease() {
    const nodeToRelease = (mutexResult && mutexResult.requestingNode) ? mutexResult.requestingNode : mutexNode;
    try {
      const res = await releaseMutexLock(nodeToRelease);
      setMutexResult((prev) => (prev ? { ...prev, granted: false, selfStudyNote: res.message || `Lock released by ${nodeToRelease}` } : null));
    } catch (e) {
      console.error(e);
    }
  }

  // Handlers for Lodha & Kshemkalyani Fair Mutex
  async function handleLKRequest() {
    setLkBusy(true);
    try {
      const res = await requestLKMutexLock(lkNode);
      setLkResult(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLkBusy(false);
    }
  }

  async function handleLKRelease() {
    const nodeToRelease = (lkResult && lkResult.requestingNode) ? lkResult.requestingNode : lkNode;
    try {
      const res = await releaseLKMutexLock(nodeToRelease);
      setLkResult((prev) =>
        prev
          ? {
              ...prev,
              granted: false,
              priorityOrder: res.remainingQueue?.map((r) => r.nodeId) || [],
            }
          : null
      );
    } catch (e) {
      console.error(e);
    }
  }

  // Handler for Real Backend-Driven Race Condition Demonstration
  async function runRaceSimulation(mode) {
    setRaceRunning(true);
    setRaceMode(mode);
    setRaceResult(null);

    try {
      const res = await runRaceExperiment(mode);
      setRaceResult(res);
    } catch (err) {
      console.error("Race experiment failed:", err);
      setRaceResult({
        mode: mode === "unlocked" ? "UNSYNCHRONIZED (RACE CONDITION DETECTED)" : "SYNCHRONIZED VIA DISTRIBUTED MUTEX",
        initialBalance: 1000,
        tx1Amount: 800,
        tx2Amount: 800,
        tx1Outcome: "Error: " + err.message,
        tx2Outcome: "Error executing backend experiment",
        finalBalance: 1000,
        anomaly: "Backend execution failure: " + err.message,
        isSafe: false,
      });
    } finally {
      setRaceRunning(false);
    }
  }

  // Handlers for Consistency & Replication Experiment
  async function handleTogglePartition(enabled) {
    setConsistencyBusy(true);
    try {
      const res = await toggleConsistencyPartition(enabled);
      setConsistencyData((prev) => (prev ? { ...prev, partitioned: res.partitioned, replicas: res.replicas } : null));
      setConsistencyFeedback({
        type: "info",
        message: `Network partition ${enabled ? "ACTIVATED across replica nodes (Split-Brain / Isolated Replicas)" : "HEALED (All replicas connected)"}`,
      });
    } catch (e) {
      setConsistencyFeedback({ type: "error", message: e.message });
    } finally {
      setConsistencyBusy(false);
    }
  }

  async function handleSetModel(model) {
    setConsistencyBusy(true);
    try {
      const res = await setConsistencyModel(model);
      setConsistencyData((prev) => (prev ? { ...prev, model: res.model } : null));
      setConsistencyFeedback({
        type: "info",
        message: `Replication model switched to ${res.model} (${res.model === "STRICT" ? "Strong CP - Quorum Required" : "Eventual AP - Availability Prioritized"})`,
      });
    } catch (e) {
      setConsistencyFeedback({ type: "error", message: e.message });
    } finally {
      setConsistencyBusy(false);
    }
  }

  async function handleWriteConsistency() {
    setConsistencyBusy(true);
    try {
      const parsedVal = isNaN(Number(writeValue)) ? writeValue : Number(writeValue);
      const res = await writeConsistencyRecord(writeKey, parsedVal, writeTarget);
      if (res.replicas) {
        setConsistencyData((prev) => (prev ? { ...prev, replicas: res.replicas } : null));
      }
      setConsistencyFeedback({
        type: "success",
        message: `Write committed on ${res.targetReplica}: '${res.key}' = ${res.value} (v${res.version})`,
      });
    } catch (e) {
      setConsistencyFeedback({ type: "error", message: e.message });
    } finally {
      setConsistencyBusy(false);
    }
  }

  async function handleReconcileConsistency() {
    setConsistencyBusy(true);
    try {
      const res = await reconcileConsistency(reconcileStrategy);
      if (res.replicas) {
        setConsistencyData((prev) => (prev ? { ...prev, replicas: res.replicas, reconciliationLog: res.reconciliationLog } : null));
      }
      setConsistencyFeedback({
        type: "success",
        message: `Reconciled across ${res.reconciledKeys?.length || 0} keys using ${res.strategy}`,
      });
    } catch (e) {
      setConsistencyFeedback({ type: "error", message: e.message });
    } finally {
      setConsistencyBusy(false);
    }
  }

  async function handleResetConsistency() {
    setConsistencyBusy(true);
    try {
      await resetConsistency();
      await loadConsistency();
      setConsistencyFeedback({ type: "info", message: "Consistency cluster reset to clean initial baseline." });
    } catch (e) {
      setConsistencyFeedback({ type: "error", message: e.message });
    } finally {
      setConsistencyBusy(false);
    }
  }

  return (
    <PageShell connStatus={connStatus}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="unit-tag">Part 3 &bull; Unit III Distributed Synchronization</div>
          <h1 className="page-title">Synchronization, Logical Clocks &amp; Replication</h1>
          <p className="page-subtitle">
            Monotonic Lamport Logical Clocks, Distributed Mutual Exclusion (Ricart-Agrawala &amp; Token Ring), Lodha &amp; Kshemkalyani's Fair Mutex, Real Concurrency Race Simulation, and CAP Theorem Consistency Models.
          </p>
        </div>

        {/* Sub-Tab Navigation */}
        <div className="segmented-pills">
          <button
            type="button"
            className={`seg-pill ${activeTab === "lamport" ? "active" : ""}`}
            onClick={() => setActiveTab("lamport")}
          >
            1. Lamport's Logical Clocks
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "mutex" ? "active" : ""}`}
            onClick={() => setActiveTab("mutex")}
          >
            2. Mutual Exclusion (Ricart-Agrawala &amp; Token-Ring)
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "lk" ? "active" : ""}`}
            onClick={() => setActiveTab("lk")}
          >
            3. Lodha-Kshemkalyani Fair Mutex
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "race" ? "active" : ""}`}
            onClick={() => setActiveTab("race")}
          >
            4. Race Condition Simulator
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "consistency" ? "active" : ""}`}
            onClick={() => setActiveTab("consistency")}
          >
            5. Replication &amp; CAP Theorem
          </button>
        </div>
      </div>

      {/* 1. LAMPORT CLOCKS */}
      {activeTab === "lamport" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <GitCommit size={18} style={{ color: "var(--upi-green)" }} />
                <span>Lamport's Logical Clock Algorithm (Monotonic Causal Ordering)</span>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={resetLamportClocks}
                style={{ padding: "4px 10px", fontSize: "0.76rem" }}
              >
                <RotateCcw size={13} />
                <span>Reset Clocks</span>
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", lineHeight: 1.55, marginBottom: "16px" }}>
              Leslie Lamport demonstrated that absolute physical time is unnecessary to order distributed events. Lamport's algorithm assigns a monotonically increasing integer <strong>L</strong> ensuring that if event A happens-before event B (A &rarr; B), then <strong>L(A) &lt; L(B)</strong>.
            </p>

            {/* Logical Clock Displays */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "16px" }}>
              {lamportNodes.map((n, idx) => (
                <div
                  key={n.id || n.nodeId || `lamport-node-${idx}`}
                  style={{
                    padding: "14px",
                    border: "1px solid var(--border-hairline)",
                    borderRadius: "var(--radius-sm)",
                    background: "#FFFFFF",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: "0.85rem", color: "var(--ink-primary)" }}>{n.name || n.nodeId}</strong>
                    <span className="status-pill neutral" style={{ fontSize: "0.68rem" }}>Node {idx + 1}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                    <span style={{ fontSize: "0.74rem", color: "var(--ink-muted)", textTransform: "uppercase" }}>Logical Clock:</span>
                    <strong className="tabular-nums" style={{ fontSize: "1.4rem", color: "var(--upi-orange)" }}>
                      L = {n.clock ?? n.lamportClock ?? 0}
                    </strong>
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--ink-muted)" }}>
                    Last Event: {n.lastEvent || "System Initialized"}
                  </div>
                </div>
              ))}
            </div>

            {/* Interactive Clock Event Dispatcher */}
            <div style={{ padding: "16px", borderRadius: "var(--radius-sm)", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", marginBottom: "16px" }}>
              <h4 style={{ fontSize: "0.92rem", fontWeight: 700, color: "var(--ink-primary)", marginBottom: "8px" }}>
                Dispatch Interactive Distributed Clock Events:
              </h4>
              <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", marginBottom: "12px" }}>
                Trigger local ticks, message sends, and cross-node receives to observe how Lamport timestamps increment and synchronize:
              </p>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={lamportBusy}
                  onClick={() => handleTriggerLamport("INTERNAL", "sender-bank", null, "Verify PIN & Account Integrity")}
                  style={{ fontSize: "0.78rem", padding: "6px 12px" }}
                >
                  Local Event (HDFC): L &rarr; L + 1
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={lamportBusy}
                  onClick={() => handleTriggerLamport("SEND", "sender-bank", "npci", "Forward Debit Authorization Packet")}
                  style={{ fontSize: "0.78rem", padding: "6px 12px" }}
                >
                  Send Msg (HDFC &rarr; NPCI): Stamp L_send
                </button>
                <button
                  type="button"
                  className="btn-green"
                  disabled={lamportBusy}
                  onClick={() => handleTriggerLamport("RECEIVE", "receiver-bank", "npci", "Receive Credit Directive")}
                  style={{ fontSize: "0.78rem", padding: "6px 12px" }}
                >
                  Receive Msg (ICICI): L = max(L, T_msg) + 1
                </button>
              </div>
            </div>

            {/* Interceptor Table */}
            {interceptorData?.recentLogs && (
              <div>
                <h4 style={{ fontSize: "0.92rem", fontWeight: 700, color: "var(--ink-primary)", marginBottom: "8px" }}>
                  Intercepted Inter-Service HTTP Calls with Lamport Headers
                </h4>
                <div className="table-container">
                  <table className="fintech-table">
                    <thead>
                      <tr>
                        <th>Call ID</th>
                        <th>Method</th>
                        <th>From &bull; To</th>
                        <th>Timestamp L</th>
                        <th>Header Injection</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {interceptorData.recentLogs.slice(0, 6).map((log, idx) => (
                        <tr key={idx}>
                          <td><code>{log.callId || `CALL-${idx}`}</code></td>
                          <td><span className="status-pill success">{log.method}</span></td>
                          <td>{log.fromNode} &rarr; {log.toNode}</td>
                          <td><strong className="tabular-nums" style={{ color: "var(--upi-orange)" }}>L = {log.lamportTimestamp}</strong></td>
                          <td><code>x-lamport-clock: {log.lamportTimestamp}</code></td>
                          <td><span className="tabular-nums">{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "--"}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. DISTRIBUTED MUTUAL EXCLUSION BASELINE (RICART-AGRAWALA & TOKEN-RING) */}
      {activeTab === "mutex" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Lock size={18} style={{ color: "var(--upi-orange)" }} />
                <span>Distributed Mutual Exclusion (Ricart-Agrawala &amp; Token-Ring)</span>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--ink-secondary)" }}>Node:</span>
                  <select
                    className="form-select"
                    style={{ padding: "4px 8px", fontSize: "0.78rem", width: "auto" }}
                    value={mutexNode}
                    onChange={(e) => setMutexNode(e.target.value)}
                  >
                    <option value="sender-bank">Sender Bank (HDFC)</option>
                    <option value="transaction-service">Transaction Service</option>
                    <option value="npci">NPCI Switch</option>
                    <option value="receiver-bank">Receiver Bank (ICICI)</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleMutexRequest("Ricart-Agrawala")}
                  disabled={mutexBusy}
                  style={{ fontSize: "0.78rem", padding: "6px 12px" }}
                >
                  Request (Ricart-Agrawala)
                </button>
                <button
                  type="button"
                  className="btn-green"
                  onClick={() => handleMutexRequest("Token-Ring")}
                  disabled={mutexBusy}
                  style={{ fontSize: "0.78rem", padding: "6px 12px" }}
                >
                  Request (Token Ring)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleMutexRelease}
                  style={{ fontSize: "0.78rem", padding: "6px 12px" }}
                >
                  Release Lock
                </button>
              </div>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", lineHeight: 1.55, marginBottom: "16px" }}>
              To prevent race conditions when concurrent transactions attempt to debit or credit the same bank ledger simultaneously, distributed nodes acquire a <strong>Distributed Mutual Exclusion Lock</strong>. Nodes transition across explicit states (<code>RELEASED</code>, <code>WANTED</code>, <code>HELD</code>) without single-process in-memory lock shims.
            </p>

            {mutexResult && (
              <div style={{ padding: "14px", borderRadius: "var(--radius-sm)", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <strong>Status: <span className={`status-pill ${mutexResult.granted ? "success" : "warning"}`}>{mutexResult.granted ? "LOCK GRANTED" : "QUEUED"}</span></strong>
                  <span>Messages Exchanged: <strong className="tabular-nums">{mutexResult.messagesExchanged}</strong></span>
                </div>
                <div style={{ fontSize: "0.82rem", color: "var(--ink-secondary)" }}>
                  {mutexResult.selfStudyNote}
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px", marginTop: "10px" }}>
              <div style={{ padding: "14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <h4 style={{ fontSize: "0.92rem", fontWeight: 700, color: "var(--ink-primary)", marginBottom: "4px" }}>Ricart-Agrawala Algorithm</h4>
                <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                  Permission-based decentralized algorithm. A node wishing to enter CS multicasts a REQUEST with its Lamport timestamp to all other nodes. Receivers reply OK immediately if RELEASED or if their own request has a higher timestamp; otherwise they defer the reply.
                </p>
                <div style={{ fontSize: "0.75rem", color: "var(--ink-muted)", marginTop: "6px" }}>
                  Message complexity: <strong>2(N - 1)</strong> messages per CS entry.
                </div>
              </div>

              <div style={{ padding: "14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <h4 style={{ fontSize: "0.92rem", fontWeight: 700, color: "var(--ink-primary)", marginBottom: "4px" }}>Token-Ring Algorithm</h4>
                <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", lineHeight: 1.5 }}>
                  Token-based algorithm where nodes form a logical ring. A unique token continuously circulates from node to node. Only the node holding the token can enter the critical section and perform ledger updates.
                </p>
                <div style={{ fontSize: "0.75rem", color: "var(--ink-muted)", marginTop: "6px" }}>
                  Message complexity: <strong>0 to (N - 1)</strong> messages per CS entry. No starvation.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. LODHA & KSHEMKALYANI'S FAIR MUTUAL EXCLUSION */}
      {activeTab === "lk" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div>
                <div className="card-title">
                  <Award size={18} style={{ color: "var(--upi-orange)" }} />
                  <span>Lodha and Kshemkalyani's Fair Mutual Exclusion Algorithm</span>
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--ink-muted)", marginTop: "2px" }}>
                  Strict FIFO Causal Ordering &amp; Bounded Waiting Under Asynchronous Channels
                </div>
              </div>
              <span className="status-pill success">Bounded Waiting</span>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", lineHeight: 1.55, marginBottom: "16px" }}>
              Standard Ricart-Agrawala can suffer from starvation under heavy bursts of concurrent transactions. <strong>Lodha and Kshemkalyani</strong> introduced a strictly fair distributed mutual exclusion algorithm ensuring <strong>bounded waiting</strong> and <strong>FIFO fairness</strong>. Requests are ordered by causal timestamps <code>(L_i, i)</code>, and multicasts are restricted dynamically to minimal request sets.
            </p>

            <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Requesting Actor:</span>
                <select
                  className="form-select"
                  style={{ padding: "4px 10px", fontSize: "0.82rem", width: "auto" }}
                  value={lkNode}
                  onChange={(e) => setLkNode(e.target.value)}
                >
                  <option value="sender-bank">Sender Bank (Node 1)</option>
                  <option value="transaction-service">Transaction Service (Node 2)</option>
                  <option value="npci">NPCI Switch (Node 3)</option>
                  <option value="receiver-bank">Receiver Bank (Node 4)</option>
                </select>
              </div>

              <button
                type="button"
                className="btn-primary"
                onClick={handleLKRequest}
                disabled={lkBusy}
                style={{ fontSize: "0.78rem", padding: "6px 12px" }}
              >
                Request Fair Mutex
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={handleLKRelease}
                style={{ fontSize: "0.78rem", padding: "6px 12px" }}
              >
                Release Fair Lock
              </button>
            </div>

            {lkResult && (
              <div style={{ padding: "14px", borderRadius: "var(--radius-sm)", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
                  <span>Lock State: <strong className={`status-pill ${lkResult.granted ? "success" : "warning"}`}>{lkResult.granted ? "GRANTED" : "QUEUED FAIRLY"}</strong></span>
                  <span>Messages Exchanged: <strong className="tabular-nums">{lkResult.messagesExchanged}</strong> (Restricted Set)</span>
                </div>

                <div style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", marginBottom: "8px" }}>
                  <strong>Causal Priority Queue:</strong> {lkResult.priorityOrder?.join(" &rarr; ") || "None"}
                </div>

                <div style={{ fontSize: "0.76rem", color: "var(--blue-accent)", background: "var(--blue-tint)", padding: "6px 10px", borderRadius: "4px", marginBottom: "12px" }}>
                  <strong>Fairness Invariant:</strong> {lkResult.fairnessGuarantee || "No process requesting CS is passed more than once by any other process."}
                </div>

                <h4 style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--ink-primary)", marginBottom: "6px" }}>Algorithmic Execution Trace</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {(lkResult.trace || []).map((step, idx) => (
                    <div key={idx} style={{ padding: "8px 10px", background: "#FFFFFF", border: "1px solid var(--border-hairline)", borderRadius: "4px", fontSize: "0.78rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                        <span>{step.action} ({step.actor})</span>
                        <span className="tabular-nums" style={{ color: "var(--ink-muted)", fontSize: "0.72rem" }}>L={step.clock}</span>
                      </div>
                      <div style={{ color: "var(--ink-secondary)", fontSize: "0.74rem" }}>{step.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. RACE CONDITION & CRITICAL SECTION DEMONSTRATION */}
      {activeTab === "race" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <AlertTriangle size={18} style={{ color: "var(--upi-orange)" }} />
                <span>Concurrent Race Condition &amp; Critical Section Simulator</span>
              </div>
              <span className="status-pill warning">Concurrency Verification</span>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", lineHeight: 1.55, marginBottom: "16px" }}>
              Simulates two concurrent payment transfers (Tx 1: ₹800 and Tx 2: ₹800) attempting to debit an account with only ₹1,000 balance simultaneously. Observe what happens with and without distributed mutual exclusion:
            </p>

            {/* Test Action Controls */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "18px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-danger"
                disabled={raceRunning}
                onClick={() => runRaceSimulation("unlocked")}
              >
                <Play size={13} />
                <span>Simulate Unsynchronized (Trigger Race Condition)</span>
              </button>

              <button
                type="button"
                className="btn-green"
                disabled={raceRunning}
                onClick={() => runRaceSimulation("locked")}
              >
                <Play size={13} />
                <span>Simulate Synchronized (Via Distributed Mutex)</span>
              </button>
            </div>

            {/* Race Simulation Output */}
            {raceResult && (
              <div
                style={{
                  padding: "16px",
                  borderRadius: "var(--radius-sm)",
                  background: raceResult.isSafe ? "var(--upi-green-tint)" : "var(--crimson-tint)",
                  border: raceResult.isSafe ? "1px solid var(--upi-green-border)" : "1px solid var(--crimson-border)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <strong style={{ fontSize: "0.92rem", color: raceResult.isSafe ? "var(--upi-green)" : "var(--crimson)" }}>
                    {raceResult.mode}
                  </strong>
                  <span className={`status-pill ${raceResult.isSafe ? "success" : "danger"}`}>
                    {raceResult.isSafe ? "Zero Overdraft" : "Anomaly Detected"}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px", fontSize: "0.8rem", marginBottom: "12px" }}>
                  <div style={{ padding: "8px 12px", background: "#FFFFFF", borderRadius: "6px", border: "1px solid var(--border-hairline)" }}>
                    <span style={{ color: "var(--ink-muted)", fontSize: "0.72rem" }}>Initial Account Balance:</span>
                    <div className="tabular-nums" style={{ fontWeight: 700, fontSize: "1rem" }}>₹{raceResult.initialBalance}</div>
                  </div>
                  <div style={{ padding: "8px 12px", background: "#FFFFFF", borderRadius: "6px", border: "1px solid var(--border-hairline)" }}>
                    <span style={{ color: "var(--ink-muted)", fontSize: "0.72rem" }}>Tx 1 Outcome (₹{raceResult.tx1Amount}):</span>
                    <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--ink-primary)" }}>{raceResult.tx1Outcome}</div>
                  </div>
                  <div style={{ padding: "8px 12px", background: "#FFFFFF", borderRadius: "6px", border: "1px solid var(--border-hairline)" }}>
                    <span style={{ color: "var(--ink-muted)", fontSize: "0.72rem" }}>Tx 2 Outcome (₹{raceResult.tx2Amount}):</span>
                    <div style={{ fontWeight: 600, fontSize: "0.82rem", color: raceResult.isSafe ? "var(--upi-green)" : "var(--crimson)" }}>{raceResult.tx2Outcome}</div>
                  </div>
                  <div style={{ padding: "8px 12px", background: "#FFFFFF", borderRadius: "6px", border: "1px solid var(--border-hairline)" }}>
                    <span style={{ color: "var(--ink-muted)", fontSize: "0.72rem" }}>Final Account Balance:</span>
                    <div className="tabular-nums" style={{ fontWeight: 800, fontSize: "1.1rem", color: raceResult.isSafe ? "var(--upi-green)" : "var(--crimson)" }}>
                      ₹{raceResult.finalBalance}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: "0.84rem", fontWeight: 600, color: raceResult.isSafe ? "var(--upi-green)" : "var(--crimson)", lineHeight: 1.5 }}>
                  {raceResult.anomaly}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. DISTRIBUTED DATABASE CONSISTENCY & REPLICATION (CAP THEOREM) */}
      {activeTab === "consistency" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Database size={18} style={{ color: "var(--upi-green)" }} />
                <span>Distributed Database Replication, CAP Theorem &amp; Consistency Models</span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleResetConsistency}
                  disabled={consistencyBusy}
                  style={{ padding: "4px 10px", fontSize: "0.76rem" }}
                >
                  <RotateCcw size={13} />
                  <span>Reset Cluster</span>
                </button>
              </div>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", lineHeight: 1.55, marginBottom: "16px" }}>
              In accordance with <strong>Brewer's CAP Theorem</strong>, a distributed data store cannot simultaneously guarantee Consistency, Availability, and Partition Tolerance. When network partitions (P) occur between banking data centers, systems must choose between <strong>CP (Strict Consistency via Quorum/2PC - sacrificing Availability)</strong> and <strong>AP (Eventual Consistency - sacrificing Consistency for High Availability)</strong>.
            </p>

            {/* Live Cluster Control Panel */}
            <div style={{ padding: "16px", borderRadius: "var(--radius-sm)", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", marginBottom: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>Replication Model:</span>
                  <button
                    type="button"
                    className={`btn-${consistencyData?.model === "STRICT" ? "primary" : "secondary"}`}
                    disabled={consistencyBusy}
                    onClick={() => handleSetModel("STRICT")}
                    style={{ fontSize: "0.76rem", padding: "4px 10px" }}
                  >
                    Strict Consistency (CP)
                  </button>
                  <button
                    type="button"
                    className={`btn-${consistencyData?.model === "EVENTUAL" ? "green" : "secondary"}`}
                    disabled={consistencyBusy}
                    onClick={() => handleSetModel("EVENTUAL")}
                    style={{ fontSize: "0.76rem", padding: "4px 10px" }}
                  >
                    Eventual Consistency (AP)
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>Network Partition:</span>
                  {consistencyData?.partitioned ? (
                    <button
                      type="button"
                      className="btn-green"
                      disabled={consistencyBusy}
                      onClick={() => handleTogglePartition(false)}
                      style={{ fontSize: "0.76rem", padding: "4px 12px" }}
                    >
                      <Radio size={12} />
                      <span>Heal Partition (Reconnect Cluster)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={consistencyBusy}
                      onClick={() => handleTogglePartition(true)}
                      style={{ fontSize: "0.76rem", padding: "4px 12px" }}
                    >
                      <Split size={12} />
                      <span>Simulate Network Partition</span>
                    </button>
                  )}
                </div>
              </div>

              {consistencyFeedback && (
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: "4px",
                    fontSize: "0.8rem",
                    marginBottom: "12px",
                    background:
                      consistencyFeedback.type === "error"
                        ? "var(--crimson-tint)"
                        : consistencyFeedback.type === "success"
                        ? "var(--upi-green-tint)"
                        : "var(--blue-tint)",
                    color:
                      consistencyFeedback.type === "error"
                        ? "var(--crimson)"
                        : consistencyFeedback.type === "success"
                        ? "var(--upi-green)"
                        : "var(--blue-accent)",
                    border:
                      consistencyFeedback.type === "error"
                        ? "1px solid var(--crimson-border)"
                        : consistencyFeedback.type === "success"
                        ? "1px solid var(--upi-green-border)"
                        : "1px solid var(--blue-border, #bfdbfe)",
                  }}
                >
                  {consistencyFeedback.message}
                </div>
              )}

              {/* 3 Distributed Data Center Replicas */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
                {(consistencyData?.replicas || []).map((replica) => (
                  <div
                    key={replica.id}
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid var(--border-hairline)",
                      borderRadius: "6px",
                      padding: "12px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <div>
                        <strong style={{ fontSize: "0.85rem", color: "var(--ink-primary)" }}>{replica.name}</strong>
                        <div style={{ fontSize: "0.7rem", color: "var(--ink-muted)" }}>{replica.region} &bull; {replica.role.toUpperCase()}</div>
                      </div>
                      <span className={`status-pill ${replica.status === "ONLINE" ? "success" : "danger"}`} style={{ fontSize: "0.68rem" }}>
                        {replica.status}
                      </span>
                    </div>

                    <div style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--ink-muted)", marginBottom: "4px" }}>
                      Replicated KV Store:
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "150px", overflowY: "auto" }}>
                      {Object.entries(replica.records || {}).map(([k, rec]) => (
                        <div
                          key={k}
                          style={{
                            padding: "6px 8px",
                            background: "var(--bg-canvas)",
                            borderRadius: "4px",
                            fontSize: "0.74rem",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 600, color: "var(--ink-primary)" }}>{k}: </span>
                            <span className="tabular-nums" style={{ color: "var(--upi-orange)", fontWeight: 700 }}>{JSON.stringify(rec.value)}</span>
                          </div>
                          <span className="status-pill neutral" style={{ fontSize: "0.65rem" }}>v{rec.version}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Interactive Write Dispatcher & Reconciliation */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
              {/* Write Dispatcher */}
              <div style={{ padding: "14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <h4 style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--ink-primary)", marginBottom: "6px" }}>
                  Dispatch Replicated Write Operation
                </h4>
                <p style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", marginBottom: "10px" }}>
                  Observe whether the write is accepted locally or rejected by quorum partition barriers.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div>
                    <label style={{ fontSize: "0.72rem", color: "var(--ink-muted)", display: "block", marginBottom: "2px" }}>Target Replica:</label>
                    <select
                      className="form-select"
                      style={{ fontSize: "0.78rem", padding: "4px 8px", width: "100%" }}
                      value={writeTarget}
                      onChange={(e) => setWriteTarget(e.target.value)}
                    >
                      {(consistencyData?.replicas || []).map((r) => (
                        <option key={r.id} value={r.id}>{r.name} ({r.status})</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div>
                      <label style={{ fontSize: "0.72rem", color: "var(--ink-muted)", display: "block", marginBottom: "2px" }}>Record Key:</label>
                      <input
                        type="text"
                        className="form-input"
                        style={{ fontSize: "0.78rem", padding: "4px 8px", width: "100%" }}
                        value={writeKey}
                        onChange={(e) => setWriteKey(e.target.value)}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.72rem", color: "var(--ink-muted)", display: "block", marginBottom: "2px" }}>New Value:</label>
                      <input
                        type="text"
                        className="form-input"
                        style={{ fontSize: "0.78rem", padding: "4px 8px", width: "100%" }}
                        value={writeValue}
                        onChange={(e) => setWriteValue(e.target.value)}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn-primary"
                    disabled={consistencyBusy}
                    onClick={handleWriteConsistency}
                    style={{ fontSize: "0.78rem", padding: "6px 12px", marginTop: "4px" }}
                  >
                    Execute Distributed Write
                  </button>
                </div>
              </div>

              {/* Reconciliation Trigger */}
              <div style={{ padding: "14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <h4 style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--ink-primary)", marginBottom: "6px" }}>
                  Cluster Conflict Reconciliation (Anti-Entropy)
                </h4>
                <p style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", marginBottom: "10px" }}>
                  After healing a network partition, converge diverged replicas using consensus or conflict resolution.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div>
                    <label style={{ fontSize: "0.72rem", color: "var(--ink-muted)", display: "block", marginBottom: "2px" }}>Conflict Resolution Strategy:</label>
                    <select
                      className="form-select"
                      style={{ fontSize: "0.78rem", padding: "4px 8px", width: "100%" }}
                      value={reconcileStrategy}
                      onChange={(e) => setReconcileStrategy(e.target.value)}
                    >
                      <option value="LAST_WRITE_WINS">Last-Write-Wins (Physical Timestamp + Causal Version)</option>
                      <option value="HIGHEST_VERSION">Highest Monotonic Version Vector</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    className="btn-green"
                    disabled={consistencyBusy}
                    onClick={handleReconcileConsistency}
                    style={{ fontSize: "0.78rem", padding: "6px 12px", marginTop: "4px" }}
                  >
                    Trigger Asynchronous Reconciliation
                  </button>

                  {consistencyData?.reconciliationLog && consistencyData.reconciliationLog.length > 0 && (
                    <div style={{ marginTop: "8px", maxHeight: "90px", overflowY: "auto", fontSize: "0.72rem", color: "var(--ink-secondary)" }}>
                      <div style={{ fontWeight: 600, marginBottom: "4px" }}>Recent Convergence Events:</div>
                      {consistencyData.reconciliationLog.slice(0, 3).map((log, idx) => (
                        <div key={idx} style={{ padding: "2px 0", borderBottom: "1px dashed var(--border-hairline)" }}>
                          &bull; {log.key}: {log.details}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
