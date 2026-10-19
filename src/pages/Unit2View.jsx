import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import PageShell from "../components/layout/PageShell";
import {
  fetchSnapshot,
  toggleFailure,
  resetSystem,
  initiateTransaction,
  connectTransactionSocket,
  invokeRpcCall,
  fetchQueueStatus,
  publishQueueMessage,
  consumeQueueMessage,
  testQueueDuplicate,
  fetchNamingServices,
  resolveNamingService,
  triggerUncertainFault,
  reconcileFault,
} from "../api";
import {
  MessageSquare,
  Zap,
  Radio,
  Share2,
  ShieldAlert,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Terminal,
  ArrowRightLeft,
  Send,
  Database,
  Layers,
  Network,
  Cpu,
  Clock,
  ShieldCheck,
  Search,
} from "lucide-react";

export default function Unit2View() {
  const [activeTab, setActiveTab] = useState("rpc");
  const [snapshot, setSnapshot] = useState(null);
  const [connStatus, setConnStatus] = useState("connecting");

  // 1. RPC Comparison State
  const [rpcProtocol, setRpcProtocol] = useState("GRPC_HTTP2");
  const [rpcProcedure, setRpcProcedure] = useState("VerifyAndDebit");
  const [rpcAmount, setRpcAmount] = useState(250);
  const [rpcAccount, setRpcAccount] = useState("sanika@bank");
  const [rpcTimeoutMs, setRpcTimeoutMs] = useState(2000);
  const [rpcLoading, setRpcLoading] = useState(false);
  const [rpcResult, setRpcResult] = useState(null);

  // 2. Message-Oriented AMQP Queue State
  const [queueStatus, setQueueStatus] = useState(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queuePublishResult, setQueuePublishResult] = useState(null);
  const [queueConsumeResult, setQueueConsumeResult] = useState(null);
  const [duplicateTestResult, setDuplicateTestResult] = useState(null);
  const [queueRoutingKey, setQueueRoutingKey] = useState("txn.debit.remitter");
  const [queueAmount, setQueueAmount] = useState(350);

  // 3. WebRTC & Stream State
  const [roomId, setRoomId] = useState("upi-mesh-alpha");
  const [peerState, setPeerState] = useState("IDLE"); // IDLE, SIGNALING, CONNECTED
  const [peerMessages, setPeerMessages] = useState([]);
  const [p2pAmount, setP2pAmount] = useState(150);
  const [authoritativeTxn, setAuthoritativeTxn] = useState(null);

  // 4. Fault Tolerance & Chaos State
  const [chaosLoading, setChaosLoading] = useState(false);
  const [uncertainTxnId, setUncertainTxnId] = useState("TXN-RECON-7701");
  const [uncertainResult, setUncertainResult] = useState(null);
  const [reconcileResult, setReconcileResult] = useState(null);

  // 5. Names, Identifiers, and Addresses State
  const [namingData, setNamingData] = useState(null);
  const [lookupKey, setLookupKey] = useState("npci");
  const [lookupResult, setLookupResult] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [snap, qStat, nData] = await Promise.all([
        fetchSnapshot(),
        fetchQueueStatus().catch(() => null),
        fetchNamingServices().catch(() => null),
      ]);
      setSnapshot(snap);
      if (qStat) setQueueStatus(qStat);
      if (nData) setNamingData(nData);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadData();
    const ws = connectTransactionSocket(() => loadData(), setConnStatus);
    return () => ws.close();
  }, [loadData]);

  // Handler: Execute RPC Comparison Call
  async function handleExecuteRpc() {
    setRpcLoading(true);
    setRpcResult(null);
    try {
      const res = await invokeRpcCall({
        protocol: rpcProtocol,
        procedureName: rpcProcedure,
        callingService: "Transaction Coordinator",
        receivingService: "Sender Bank CBS",
        payload: { account: rpcAccount, amount: Number(rpcAmount) },
        timeoutMs: Number(rpcTimeoutMs),
      });
      setRpcResult(res);
      await loadData();
    } catch (err) {
      setRpcResult({ error: err.message });
    } finally {
      setRpcLoading(false);
    }
  }

  // Handler: Publish AMQP Message
  async function handlePublishMessage() {
    setQueueLoading(true);
    try {
      const res = await publishQueueMessage({
        exchange: "upi.transactions",
        routingKey: queueRoutingKey,
        payload: { amount: Number(queueAmount), senderUpi: "sanika@bank", receiverUpi: "navya@bank" },
      });
      setQueuePublishResult(res.envelope);
      setQueueStatus(res.brokerStatus);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setQueueLoading(false);
    }
  }

  // Handler: Consume AMQP Message
  async function handleConsumeMessage(queueName) {
    setQueueLoading(true);
    try {
      const res = await consumeQueueMessage(queueName, "worker-debit-01");
      setQueueConsumeResult(res.receipt || res);
      if (res.brokerStatus) setQueueStatus(res.brokerStatus);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setQueueLoading(false);
    }
  }

  // Handler: Test Duplicate Message Delivery (Idempotency)
  async function handleTestDuplicateDelivery() {
    setQueueLoading(true);
    try {
      const res = await testQueueDuplicate();
      setDuplicateTestResult(res);
      if (res.brokerStatus) setQueueStatus(res.brokerStatus);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setQueueLoading(false);
    }
  }

  // Handler: Resolve Service Name / Identifier
  async function handleResolveService() {
    try {
      const res = await resolveNamingService(lookupKey);
      setLookupResult(res);
    } catch (err) {
      console.error(err);
    }
  }

  // Handler: Trigger Uncertain Fault State
  async function handleTriggerUncertain() {
    try {
      const res = await triggerUncertainFault(uncertainTxnId);
      setUncertainResult(res);
      setReconcileResult(null);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  }

  // Handler: Reconcile Uncertain State
  async function handleReconcile(confirmedAtReceiver) {
    try {
      const res = await reconcileFault(uncertainTxnId, confirmedAtReceiver);
      setReconcileResult(res);
      setUncertainResult(res);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  }

  // WebRTC Handshake Simulation
  function handleStartWebRTC() {
    setPeerState("SIGNALING");
    setTimeout(() => {
      setPeerMessages([
        { type: "signal", text: `[Signaling Server (/ws/webrtc)] Peer A (sender-bank) joined room "${roomId}"` },
        { type: "signal", text: `[Signaling Server (/ws/webrtc)] Peer B (receiver-bank) joined room "${roomId}"` },
        { type: "sdp", text: `[SDP Offer] Peer A generated Offer (Type: offer, SCTP max-message-size: 262144)` },
        { type: "sdp", text: `[SDP Answer] Peer B generated Answer (Type: answer, dtls-role: passive)` },
        { type: "ice", text: `[ICE Candidate] Selected host candidate: 10.0.4.15:58320 (Typ: host, Protocol: UDP)` },
        { type: "dc", text: `[RTCDataChannel] 'upi-offline-channel' state transitioned to OPEN (SCTP over DTLS)` },
      ]);
      setPeerState("CONNECTED");
    }, 1000);
  }

  function handleSendP2PPayment() {
    if (peerState !== "CONNECTED") return;
    const now = new Date().toLocaleTimeString();
    setPeerMessages((prev) => [
      ...prev,
      {
        type: "p2p-tx",
        text: `[DataChannel SCTP Direct] Peer Micro-Payment: ₹${p2pAmount} from sanika@bank to navya@bank (Zero NPCI hop, Latency: 1.6ms, Sig: 0x8f2d...c3a1)`,
        time: now,
      },
    ]);
  }

  const failureState = snapshot?.failureState || {};

  return (
    <PageShell connStatus={connStatus}>
      {/* Part Header */}
      <div className="page-header">
        <div>
          <div className="unit-tag">
            Part 2 &bull; Unit II Communication &amp; Fault Tolerance
          </div>
          <h1 className="page-title">Distributed Communication &amp; Fault Tolerance</h1>
          <p className="page-subtitle">
            Remote Procedure Calls (gRPC vs REST), Message-Oriented Queues (AMQP), WebSockets &amp; WebRTC, Names &amp; Addresses, and 3-State Circuit Breakers.
          </p>
        </div>

        {/* Sub-tab Navigation */}
        <div className="segmented-pills">
          <button
            type="button"
            className={`seg-pill ${activeTab === "rpc" ? "active" : ""}`}
            onClick={() => setActiveTab("rpc")}
          >
            1. RPC & gRPC
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "amqp" ? "active" : ""}`}
            onClick={() => setActiveTab("amqp")}
          >
            2. Message Queues (AMQP)
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "streams" ? "active" : ""}`}
            onClick={() => setActiveTab("streams")}
          >
            3. Streams, WebSockets & WebRTC
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "naming" ? "active" : ""}`}
            onClick={() => setActiveTab("naming")}
          >
            4. Names, IDs & Addresses
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "fault" ? "active" : ""}`}
            onClick={() => setActiveTab("fault")}
          >
            5. Fault Tolerance & Retries
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* TAB 1: REMOTE PROCEDURE CALL (RPC) & gRPC                          */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "rpc" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Zap size={18} style={{ color: "var(--upi-orange)" }} />
                Remote Procedure Call (RPC) vs concrete gRPC Framework
              </div>
              <span className="status-pill success">HTTP/2 Protobuf vs HTTP/1.1 REST</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              In <strong>Remote Procedure Call (RPC)</strong>, a calling service invokes a subroutine on a remote receiving service as if it were a local in-memory call. <strong>gRPC</strong> is a high-performance concrete implementation using <strong>HTTP/2 transport</strong>, multiplexed binary <strong>Protocol Buffers</strong>, and strict typed IDL contracts. It is strictly not identical to HTTP REST.
            </p>

            {/* Interactive RPC Playground */}
            <div style={{ background: "var(--bg-canvas)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border-hairline)", marginBottom: "18px" }}>
              <h4 style={{ fontSize: "0.95rem", color: "var(--ink-primary)", marginBottom: "12px" }}>
                Interactive Distributed RPC Console:
              </h4>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px", marginBottom: "14px" }}>
                <div>
                  <label className="form-label">Protocol Framework:</label>
                  <select
                    className="form-select"
                    value={rpcProtocol}
                    onChange={(e) => setRpcProtocol(e.target.value)}
                  >
                    <option value="GRPC_HTTP2">gRPC (HTTP/2 Protocol Buffers)</option>
                    <option value="GENERIC_RPC">Generic RPC (TCP Subroutine Stub)</option>
                    <option value="REST_HTTP1">REST (HTTP/1.1 Textual JSON)</option>
                  </select>
                </div>

                <div>
                  <label className="form-label">Remote Procedure:</label>
                  <select
                    className="form-select"
                    value={rpcProcedure}
                    onChange={(e) => setRpcProcedure(e.target.value)}
                  >
                    <option value="VerifyAndDebit">VerifyAndDebit(account, amount)</option>
                    <option value="CreditBeneficiary">CreditBeneficiary(account, amount)</option>
                    <option value="GetBalance">GetBalance(account)</option>
                  </select>
                </div>

                <div>
                  <label className="form-label">Amount (₹):</label>
                  <input
                    type="number"
                    className="form-input"
                    value={rpcAmount}
                    onChange={(e) => setRpcAmount(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="form-label">Timeout Deadline (ms):</label>
                  <input
                    type="number"
                    className="form-input"
                    value={rpcTimeoutMs}
                    onChange={(e) => setRpcTimeoutMs(Number(e.target.value))}
                    title="Set < 50ms to test DEADLINE_EXCEEDED"
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleExecuteRpc}
                  disabled={rpcLoading}
                >
                  {rpcLoading ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
                  Invoke Remote Procedure
                </button>
                <span style={{ fontSize: "0.78rem", color: "var(--ink-muted)" }}>
                  (Tip: Set Timeout &lt; 50ms to trigger DEADLINE_EXCEEDED, or Amount &le; 0 to trigger INVALID_ARGUMENT)
                </span>
              </div>
            </div>

            {/* RPC Call Execution Result */}
            {rpcResult && (
              <div style={{ padding: "16px", borderRadius: "10px", background: "#FFFFFF", border: "1px solid var(--border-hairline)", marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <strong>Procedure: <code>{rpcResult.procedureName}()</code></strong>
                    <span style={{ marginLeft: "8px", fontSize: "0.78rem", color: "var(--ink-muted)" }}>
                      via {rpcResult.protocol} ({rpcResult.latencyMs}ms)
                    </span>
                  </div>
                  <span className={`status-pill ${rpcResult.executionOutcome === "SUCCESS" ? "success" : "danger"}`}>
                    Outcome: {rpcResult.executionOutcome}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px", fontSize: "0.82rem", marginBottom: "12px" }}>
                  <div style={{ background: "var(--bg-canvas)", padding: "10px", borderRadius: "6px" }}>
                    <div style={{ fontWeight: 600, color: "var(--ink-muted)", fontSize: "0.74rem" }}>CALLING SERVICE</div>
                    <div style={{ fontWeight: 700 }}>{rpcResult.callingService}</div>
                    <div style={{ fontSize: "0.74rem", color: "var(--ink-muted)", marginTop: "4px" }}>Request ID: {rpcResult.requestId}</div>
                  </div>

                  <div style={{ background: "var(--bg-canvas)", padding: "10px", borderRadius: "6px" }}>
                    <div style={{ fontWeight: 600, color: "var(--ink-muted)", fontSize: "0.74rem" }}>RECEIVING SERVICE</div>
                    <div style={{ fontWeight: 700 }}>{rpcResult.receivingService}</div>
                    <div style={{ fontSize: "0.74rem", color: "var(--ink-muted)", marginTop: "4px" }}>Correlation ID: {rpcResult.correlationId}</div>
                  </div>

                  <div style={{ background: "var(--bg-canvas)", padding: "10px", borderRadius: "6px" }}>
                    <div style={{ fontWeight: 600, color: "var(--ink-muted)", fontSize: "0.74rem" }}>RPC STATUS CODE</div>
                    <div style={{ fontWeight: 700, color: rpcResult.grpcStatus?.code === 0 ? "var(--upi-green)" : "var(--crimson)" }}>
                      Code {rpcResult.grpcStatus?.code}: {rpcResult.grpcStatus?.name}
                    </div>
                    <div style={{ fontSize: "0.74rem", color: "var(--ink-muted)", marginTop: "4px" }}>{rpcResult.grpcStatus?.description}</div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                  <div>
                    <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--ink-muted)" }}>REQUEST PAYLOAD:</span>
                    <pre style={{ margin: "4px 0", padding: "8px", background: "var(--bg-canvas)", borderRadius: "6px", fontSize: "0.76rem" }}>
                      {JSON.stringify(rpcResult.requestPayload, null, 2)}
                    </pre>
                  </div>

                  <div>
                    <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--ink-muted)" }}>RESPONSE PAYLOAD:</span>
                    <pre style={{ margin: "4px 0", padding: "8px", background: "var(--bg-canvas)", borderRadius: "6px", fontSize: "0.76rem" }}>
                      {JSON.stringify(rpcResult.responsePayload, null, 2)}
                    </pre>
                  </div>
                </div>

                <div style={{ fontSize: "0.82rem", color: "var(--blue-accent)", background: "var(--blue-tint)", padding: "8px 12px", borderRadius: "6px" }}>
                  <strong>Theoretical Distinction:</strong> {rpcResult.theoreticalDistinction}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 2: MESSAGE-ORIENTED COMMUNICATION (AMQP)                       */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "amqp" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <MessageSquare size={18} style={{ color: "var(--upi-green)" }} />
                Message-Oriented Communication (In-Process AMQP Message Broker)
              </div>
              <span className="status-pill info">Asynchronous Decoupling & Idempotency</span>
            </div>

            {/* Explicit Queue Type & Limitation Notice */}
            <div style={{ padding: "12px 16px", borderRadius: "8px", background: "var(--amber-tint)", border: "1px solid var(--amber-border)", marginBottom: "16px", fontSize: "0.82rem", color: "var(--ink-primary)" }}>
              <strong>Broker Implementation Type:</strong> <code>IN_PROCESS_IN_MEMORY_AMQP_EMULATOR</code>.
              <br />
              <span style={{ color: "var(--ink-secondary)", fontSize: "0.78rem" }}>
                {queueStatus?.limitationNotice || "This is an explicit in-process in-memory message queue. It provides AMQP 0-9-1 topic exchange, queue bindings, and idempotent consumer deduplication, but does not persist messages to disk across process restarts (unlike a physical distributed cluster of RabbitMQ or Apache Kafka nodes)."}
              </span>
            </div>

            {/* Live Queue Depths Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "18px" }}>
              <div style={{ padding: "14px", borderRadius: "8px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <span className="status-pill warning" style={{ marginBottom: "6px" }}>Queue: q.sender.debit</span>
                <div style={{ fontSize: "1.4rem", fontWeight: 800, margin: "4px 0" }}>
                  {queueStatus?.queues?.["q.sender.debit"]?.queueDepth ?? 0}
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--ink-muted)" }}>Pending Debit Messages</div>
              </div>

              <div style={{ padding: "14px", borderRadius: "8px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <span className="status-pill success" style={{ marginBottom: "6px" }}>Queue: q.receiver.credit</span>
                <div style={{ fontSize: "1.4rem", fontWeight: 800, margin: "4px 0" }}>
                  {queueStatus?.queues?.["q.receiver.credit"]?.queueDepth ?? 0}
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--ink-muted)" }}>Pending Credit Messages</div>
              </div>

              <div style={{ padding: "14px", borderRadius: "8px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <span className="status-pill info" style={{ marginBottom: "6px" }}>Queue: q.settlement.audit</span>
                <div style={{ fontSize: "1.4rem", fontWeight: 800, margin: "4px 0" }}>
                  {queueStatus?.queues?.["q.settlement.audit"]?.queueDepth ?? 0}
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--ink-muted)" }}>Audit Journal Stream</div>
              </div>

              <div style={{ padding: "14px", borderRadius: "8px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <span className="status-pill danger" style={{ marginBottom: "6px" }}>Dead Letter Exchange (DLQ)</span>
                <div style={{ fontSize: "1.4rem", fontWeight: 800, margin: "4px 0" }}>
                  {queueStatus?.deadLetterQueueDepth ?? 0}
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--ink-muted)" }}>Poison & Expired Messages</div>
              </div>
            </div>

            {/* Interactive Producer & Consumer Controls */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "18px" }}>
              {/* Producer */}
              <div style={{ padding: "16px", borderRadius: "8px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)" }}>
                <h4 style={{ fontSize: "0.95rem", color: "var(--ink-primary)", marginBottom: "10px" }}>
                  Message Producer (Publisher)
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div>
                    <label className="form-label">Routing Key:</label>
                    <select
                      className="form-select"
                      value={queueRoutingKey}
                      onChange={(e) => setQueueRoutingKey(e.target.value)}
                    >
                      <option value="txn.debit.remitter">txn.debit.remitter -&gt; q.sender.debit</option>
                      <option value="txn.credit.beneficiary">txn.credit.beneficiary -&gt; q.receiver.credit</option>
                      <option value="txn.settle.audit">txn.settle.audit -&gt; q.settlement.audit</option>
                    </select>
                  </div>

                  <div>
                    <label className="form-label">Amount (₹):</label>
                    <input
                      type="number"
                      className="form-input"
                      value={queueAmount}
                      onChange={(e) => setQueueAmount(Number(e.target.value))}
                    />
                  </div>

                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handlePublishMessage}
                    disabled={queueLoading}
                  >
                    Publish to Exchange (upi.transactions)
                  </button>
                </div>

                {queuePublishResult && (
                  <div style={{ marginTop: "10px", padding: "10px", background: "#FFFFFF", borderRadius: "6px", fontSize: "0.78rem" }}>
                    <strong>Published Message:</strong> <code>{queuePublishResult.messageId}</code>
                    <br />
                    <span>Correlation ID: <code>{queuePublishResult.correlationId}</code></span>
                  </div>
                )}
              </div>

              {/* Consumer */}
              <div style={{ padding: "16px", borderRadius: "8px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)" }}>
                <h4 style={{ fontSize: "0.95rem", color: "var(--ink-primary)", marginBottom: "10px" }}>
                  Message Consumer (Worker Pull)
                </h4>
                <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", marginBottom: "14px" }}>
                  Workers pull payment events from queue with manual ACKs, ensuring at-least-once delivery.
                </p>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                  <button
                    type="button"
                    className="btn-green"
                    onClick={() => handleConsumeMessage("q.sender.debit")}
                    disabled={queueLoading}
                  >
                    Consume from q.sender.debit
                  </button>

                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleConsumeMessage("q.receiver.credit")}
                    disabled={queueLoading}
                  >
                    Consume from q.receiver.credit
                  </button>
                </div>

                {queueConsumeResult && (
                  <div style={{ padding: "10px", background: "#FFFFFF", borderRadius: "6px", fontSize: "0.78rem" }}>
                    <strong>Receipt Status:</strong> <span className={`status-pill ${queueConsumeResult.status === "PROCESSED_SUCCESSFULLY" ? "success" : "info"}`}>{queueConsumeResult.status}</span>
                    <br />
                    <span>Effect: {queueConsumeResult.financialEffect}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Demonstration Scenario: Repeated Message Delivery & Idempotency */}
            <div style={{ padding: "16px", borderRadius: "10px", background: "#FFFFFF", border: "1px solid var(--border-hairline)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <h4 style={{ fontSize: "0.95rem", color: "var(--ink-primary)", margin: 0 }}>
                    Demonstration Scenario: Duplicate-Message Handling & Idempotent Processing
                  </h4>
                  <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", margin: "4px 0 0" }}>
                    If the consumer receives the same event twice, the application <strong>must not perform the same financial state change twice</strong>.
                  </p>
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleTestDuplicateDelivery}
                  disabled={queueLoading}
                >
                  <Play size={14} />
                  Execute Duplicate Delivery Test
                </button>
              </div>

              {duplicateTestResult && (
                <div style={{ marginTop: "12px", padding: "14px", borderRadius: "8px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "0.8rem", marginBottom: "10px" }}>
                    <div style={{ padding: "10px", background: "#FFFFFF", borderRadius: "6px", border: "1px solid var(--border-hairline)" }}>
                      <strong style={{ color: "var(--upi-green)" }}>Delivery 1 (Initial Processing):</strong>
                      <div style={{ marginTop: "4px" }}>Status: <span className="status-pill success">{duplicateTestResult.firstDelivery?.status}</span></div>
                      <div style={{ marginTop: "2px" }}>State Change Applied: <strong>{String(duplicateTestResult.firstDelivery?.stateChangeApplied)}</strong></div>
                      <div style={{ fontSize: "0.74rem", color: "var(--ink-muted)", marginTop: "4px" }}>{duplicateTestResult.firstDelivery?.financialEffect}</div>
                    </div>

                    <div style={{ padding: "10px", background: "#FFFFFF", borderRadius: "6px", border: "1px solid var(--border-hairline)" }}>
                      <strong style={{ color: "var(--upi-orange)" }}>Delivery 2 (Duplicate Retransmission):</strong>
                      <div style={{ marginTop: "4px" }}>Status: <span className="status-pill warning">{duplicateTestResult.duplicateDelivery?.status}</span></div>
                      <div style={{ marginTop: "2px" }}>State Change Applied: <strong>{String(duplicateTestResult.duplicateDelivery?.stateChangeApplied)}</strong> (NO-OP)</div>
                      <div style={{ fontSize: "0.74rem", color: "var(--ink-muted)", marginTop: "4px" }}>{duplicateTestResult.duplicateDelivery?.financialEffect}</div>
                    </div>
                  </div>

                  <div style={{ fontSize: "0.82rem", color: "var(--upi-green)", fontWeight: 600 }}>
                    ✓ {duplicateTestResult.idempotencyGuarantee}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 3: STREAMS, WEBSOCKETS & WEBRTC                                */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "streams" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Radio size={18} style={{ color: "var(--blue-accent)" }} />
                Streams, WebSockets, & WebRTC Peer DataChannels
              </div>
              <span className={`status-pill ${connStatus === "connected" ? "success" : "warning"}`}>
                WebSocket: {connStatus}
              </span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              Comprehensive demonstration of <strong>continuous event streaming</strong> (ordered sequence numbers + 500-event ring buffer replay), <strong>persistent WebSockets</strong>, and <strong>WebRTC direct peer DataChannels</strong>.
            </p>

            {/* Stream Ordering & Replay Disclaimer */}
            <div style={{ padding: "12px 16px", borderRadius: "8px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", marginBottom: "16px", fontSize: "0.82rem" }}>
              <strong>Replay vs Exactly-Once Semantics:</strong>
              <p style={{ color: "var(--ink-secondary)", margin: "4px 0 0", lineHeight: 1.5 }}>
                Stream event replay retransmits historical event frames (e.g. <code>sequence &gt; lastSeq</code>) so reconnecting clients can reconstruct view state. <strong>Event replay does NOT equal exactly-once transaction processing</strong> (which is enforced via bank database WALs and idempotency locks). The in-memory replay buffer is volatile across process restarts.
              </p>
            </div>

            {/* WebRTC P2P DataChannel Controls */}
            <div style={{ padding: "18px", borderRadius: "10px", background: "#FFFFFF", border: "1px solid var(--border-hairline)", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <h4 style={{ fontSize: "0.98rem", fontWeight: 700, margin: 0 }}>
                    WebRTC Peer-to-Peer DataChannel (SCTP over DTLS/UDP)
                  </h4>
                  <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", margin: "2px 0 0" }}>
                    Signaling relay occurs over <code>/ws/webrtc</code> (SDP offer/answer and ICE candidates). Once established, data flows directly between peers with zero intermediary server hops.
                  </p>
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="text"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    disabled={peerState !== "IDLE"}
                    title="Signaling Room"
                    style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border-hairline)", fontSize: "0.82rem" }}
                  />
                  {peerState === "IDLE" ? (
                    <button type="button" className="btn-primary" onClick={handleStartWebRTC}>
                      <Zap size={14} />
                      Start WebRTC Handshake
                    </button>
                  ) : (
                    <button type="button" className="btn-secondary" onClick={() => { setPeerState("IDLE"); setPeerMessages([]); }}>
                      Reset Session
                    </button>
                  )}
                </div>
              </div>

              {/* Peer State Topology */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "16px", alignItems: "center", padding: "14px", borderRadius: "8px", background: "var(--bg-canvas)", marginBottom: "14px" }}>
                <div style={{ padding: "12px", background: "#FFFFFF", borderRadius: "6px", textAlign: "center" }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--ink-muted)", fontWeight: 700 }}>PEER A</div>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>HDFC Remitter CBS</div>
                  <div style={{ fontSize: "0.74rem", fontFamily: "monospace" }}>peer-hdfc-01</div>
                  <span className={`status-pill ${peerState === "CONNECTED" ? "success" : "info"}`} style={{ marginTop: "4px" }}>
                    {peerState === "CONNECTED" ? "DataChannel Open" : "Ready"}
                  </span>
                </div>

                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: peerState === "CONNECTED" ? "var(--upi-green)" : "var(--ink-muted)" }}>
                    {peerState === "CONNECTED" ? "⚡ SCTP DataChannel (1.6ms)" : "Signaling (/ws/webrtc)"}
                  </div>
                  <ArrowRightLeft size={18} style={{ margin: "4px auto", color: peerState === "CONNECTED" ? "var(--upi-green)" : "var(--ink-muted)" }} />
                  <div style={{ fontSize: "0.7rem", color: "var(--ink-muted)" }}>Zero NPCI Hops</div>
                </div>

                <div style={{ padding: "12px", background: "#FFFFFF", borderRadius: "6px", textAlign: "center" }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--ink-muted)", fontWeight: 700 }}>PEER B</div>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>ICICI Beneficiary CBS</div>
                  <div style={{ fontSize: "0.74rem", fontFamily: "monospace" }}>peer-icici-02</div>
                  <span className={`status-pill ${peerState === "CONNECTED" ? "success" : "info"}`} style={{ marginTop: "4px" }}>
                    {peerState === "CONNECTED" ? "DataChannel Open" : "Ready"}
                  </span>
                </div>
              </div>

              {/* Direct payment trigger if connected */}
              {peerState === "CONNECTED" && (
                <div style={{ padding: "12px", borderRadius: "8px", background: "var(--upi-green-tint)", marginBottom: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong style={{ fontSize: "0.9rem" }}>Direct P2P Micro-Payment over DataChannel:</strong>
                    <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>Direct packet exchange between peers.</div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="number"
                      value={p2pAmount}
                      onChange={(e) => setP2pAmount(Number(e.target.value))}
                      style={{ width: "80px", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}
                    />
                    <button type="button" className="btn-green" onClick={handleSendP2PPayment}>
                      <Send size={13} />
                      Send ₹{p2pAmount}
                    </button>
                  </div>
                </div>
              )}

              {/* Terminal Packet Traces */}
              <div style={{ background: "#0F172A", color: "#E2E8F0", padding: "12px", borderRadius: "8px", fontFamily: "monospace", fontSize: "0.78rem", maxHeight: "180px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
                {peerMessages.length === 0 ? (
                  <span style={{ color: "#64748B" }}>Click &quot;Start WebRTC Handshake&quot; to inspect SDP offer/answer exchange and ICE candidates.</span>
                ) : (
                  peerMessages.map((m, idx) => (
                    <div key={idx} style={{ color: m.type === "sdp" ? "#38BDF8" : m.type === "ice" ? "#F59E0B" : m.type === "p2p-tx" ? "#10B981" : "#E2E8F0" }}>
                      {m.text}
                    </div>
                  ))
                )}
              </div>

              {/* STUN/TURN & Academic Separation Note */}
              <div style={{ marginTop: "10px", fontSize: "0.76rem", color: "var(--ink-muted)", lineHeight: 1.45 }}>
                <strong>STUN/TURN Requirements:</strong> Local demo relies on host ICE candidates. Production internet traversal across symmetric NATs requires STUN (e.g. <code>stun:stun.l.google.com:19302</code>) and TURN relays. WebRTC is used exclusively for offline proximity payments and is strictly separate from core banking transaction authorization.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 4: NAMES, IDENTIFIERS, AND ADDRESSES                           */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "naming" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <CheckCircle2 size={18} style={{ color: "var(--upi-orange)" }} />
                Names, Identifiers, and Addresses
              </div>
              <span className="status-pill info">Service Discovery & DNS</span>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              In distributed systems, confusing names, identifiers, and addresses leads to architectural errors:
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px", marginBottom: "18px" }}>
              <div style={{ padding: "14px", border: "1px solid var(--border-hairline)", borderRadius: "8px", background: "#FFFFFF" }}>
                <strong style={{ color: "var(--upi-orange)" }}>1. Name: Human-Readable Label</strong>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginTop: "4px" }}>
                  E.g. <code>sanika@bank</code> or <code>NPCI Central Clearing Switch</code>. Facilitates human interaction but does not guarantee permanence across network reconfigurations.
                </p>
              </div>

              <div style={{ padding: "14px", border: "1px solid var(--border-hairline)", borderRadius: "8px", background: "#FFFFFF" }}>
                <strong style={{ color: "var(--upi-green)" }}>2. Identifier: Unique Immutable Reference</strong>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginTop: "4px" }}>
                  E.g. UUIDv4 <code>TXN-8f3a9d12-...</code> or Node ID <code>cbs-sender-bank-hdfc-01</code>. References the entity for its entire lifetime regardless of where it moves.
                </p>
              </div>

              <div style={{ padding: "14px", border: "1px solid var(--border-hairline)", borderRadius: "8px", background: "#FFFFFF" }}>
                <strong style={{ color: "var(--blue-accent)" }}>3. Address: Resolvable Network Endpoint</strong>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginTop: "4px" }}>
                  E.g. <code>http://127.0.0.1:8001</code> or <code>10.0.4.15:50051</code>. Specifies where packets must be routed across the network fabric.
                </p>
              </div>
            </div>

            {/* Interactive Service Discovery Lookup */}
            <div style={{ background: "var(--bg-canvas)", padding: "16px", borderRadius: "10px", border: "1px solid var(--border-hairline)", marginBottom: "18px" }}>
              <h4 style={{ fontSize: "0.95rem", color: "var(--ink-primary)", marginBottom: "10px" }}>
                Service Discovery Registry Lookup:
              </h4>

              <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: "260px" }}
                  value={lookupKey}
                  onChange={(e) => setLookupKey(e.target.value)}
                  placeholder="e.g. npci, sender-bank, grpc"
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleResolveService}
                >
                  <Search size={14} />
                  Resolve Name to Address
                </button>
              </div>

              {lookupResult && (
                <div style={{ padding: "12px", borderRadius: "8px", background: "#FFFFFF", border: "1px solid var(--border-hairline)", fontSize: "0.82rem" }}>
                  {lookupResult.found ? (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                        <strong>Service: {lookupResult.descriptor?.name}</strong>
                        <span className="status-pill success">{lookupResult.descriptor?.health}</span>
                      </div>
                      <div style={{ color: "var(--ink-secondary)", marginBottom: "4px" }}>{lookupResult.resolutionPath}</div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "var(--blue-accent)", marginBottom: "8px" }}>
                        K8s DNS Record: {lookupResult.descriptor?.k8sDnsName}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "var(--ink-muted)", background: "var(--bg-canvas)", padding: "6px 10px", borderRadius: "6px" }}>
                        {lookupResult.k8sDnsExplanation}
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: "var(--crimson)" }}>
                      ❌ {lookupResult.k8sDnsExplanation}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Registered Microservices Table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: "0.8rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-hairline)", textAlign: "left", color: "var(--ink-muted)" }}>
                    <th style={{ padding: "8px" }}>Service Name</th>
                    <th style={{ padding: "8px" }}>Stable Identifier</th>
                    <th style={{ padding: "8px" }}>Network Address</th>
                    <th style={{ padding: "8px" }}>Kubernetes In-Cluster DNS Name</th>
                  </tr>
                </thead>
                <tbody>
                  {(namingData?.services || []).map((s, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--border-hairline)" }}>
                      <td style={{ padding: "8px", fontWeight: 600 }}>{s.name}</td>
                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{s.identifier}</td>
                      <td style={{ padding: "8px", fontFamily: "monospace", color: "var(--upi-orange)" }}>{s.address}</td>
                      <td style={{ padding: "8px", fontFamily: "monospace", color: "var(--blue-accent)" }}>{s.k8sDnsName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 5: FAULT TOLERANCE, CIRCUIT BREAKERS & RETRIES                  */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "fault" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <ShieldAlert size={18} style={{ color: "var(--crimson)" }} />
                Fault Tolerance, 3-State Circuit Breakers, & Reconciliation
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={resetSystem}
              >
                <RotateCcw size={14} />
                Reset All Failures
              </button>
            </div>

            <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)", lineHeight: 1.6, marginBottom: "16px" }}>
              Distributed systems must tolerate partial failure. The <strong>Circuit Breaker</strong> pattern prevents cascading collapse by failing fast when downstream services are degraded. Bounded retries (3 attempts) handle transient jitter.
            </p>

            {/* Chaos Injection Toggles */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px", marginBottom: "18px" }}>
              <div style={{ padding: "14px", borderRadius: "8px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <strong>Sender Bank (Remitter)</strong>
                  <span className={`status-pill ${failureState.sender_bank_failure ? "danger" : "success"}`}>
                    {failureState.sender_bank_failure ? "CRASHED" : "HEALTHY"}
                  </span>
                </div>
                <p style={{ fontSize: "0.78rem", color: "var(--ink-muted)", marginBottom: "10px" }}>Simulates 503 outage on remitter CBS.</p>
                <button
                  type="button"
                  className={failureState.sender_bank_failure ? "btn-secondary" : "btn-danger"}
                  onClick={() => toggleFailure("sender-bank", failureState.sender_bank_failure)}
                >
                  {failureState.sender_bank_failure ? "Restore Node" : "Trip Outage (503)"}
                </button>
              </div>

              <div style={{ padding: "14px", borderRadius: "8px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <strong>NPCI Switch Router</strong>
                  <span className={`status-pill ${failureState.npci_failure ? "danger" : "success"}`}>
                    {failureState.npci_failure ? "PARTITIONED" : "HEALTHY"}
                  </span>
                </div>
                <p style={{ fontSize: "0.78rem", color: "var(--ink-muted)", marginBottom: "10px" }}>Simulates interbank network partition.</p>
                <button
                  type="button"
                  className={failureState.npci_failure ? "btn-secondary" : "btn-danger"}
                  onClick={() => toggleFailure("npci", failureState.npci_failure)}
                >
                  {failureState.npci_failure ? "Restore Switch" : "Sever Switch Route"}
                </button>
              </div>

              <div style={{ padding: "14px", borderRadius: "8px", border: "1px solid var(--border-hairline)", background: "#FFFFFF" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <strong>Receiver Bank (Beneficiary)</strong>
                  <span className={`status-pill ${failureState.receiver_bank_failure ? "danger" : "success"}`}>
                    {failureState.receiver_bank_failure ? "CRASHED" : "HEALTHY"}
                  </span>
                </div>
                <p style={{ fontSize: "0.78rem", color: "var(--ink-muted)", marginBottom: "10px" }}>Triggers Saga Compensating Rollback refund.</p>
                <button
                  type="button"
                  className={failureState.receiver_bank_failure ? "btn-secondary" : "btn-danger"}
                  onClick={() => toggleFailure("receiver-bank", failureState.receiver_bank_failure)}
                >
                  {failureState.receiver_bank_failure ? "Restore Node" : "Trip Credit Outage"}
                </button>
              </div>
            </div>

            {/* Critical Safety Rule: UNKNOWN_OR_REQUIRES_RECONCILIATION */}
            <div style={{ padding: "16px", borderRadius: "10px", background: "#FFFFFF", border: "1px solid var(--border-hairline)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <span className="status-pill warning" style={{ marginBottom: "4px" }}>Critical Safety Rule</span>
                  <h4 style={{ fontSize: "0.98rem", margin: "4px 0", color: "var(--ink-primary)" }}>
                    Never Mark Uncertain Transactions as FAILED: UNKNOWN_OR_REQUIRES_RECONCILIATION
                  </h4>
                  <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", margin: "4px 0 0" }}>
                    If the sender was debited but the receiver ACK timed out, the transaction status is ambiguous. Marking it FAILED could result in customer double-debit or ledger imbalance.
                  </p>
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleTriggerUncertain}
                >
                  <Play size={14} />
                  Simulate Receiver Timeout After Debit
                </button>
              </div>

              {uncertainResult && (
                <div style={{ marginTop: "12px", padding: "14px", borderRadius: "8px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <strong>Transaction: <code>{uncertainResult.transactionId}</code></strong>
                    <span className="status-pill warning">{uncertainResult.state}</span>
                  </div>

                  <p style={{ fontSize: "0.82rem", color: "var(--ink-secondary)", marginBottom: "10px" }}>
                    {uncertainResult.reconciliationAction}
                  </p>

                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>End-of-Day (EOD) Reconciliation Actions:</span>
                    <button
                      type="button"
                      className="btn-green"
                      onClick={() => handleReconcile(true)}
                    >
                      Receiver Confirmed Credit -&gt; Mark COMPLETED
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleReconcile(false)}
                    >
                      Receiver Missing Credit -&gt; Refund &amp; Mark FAILED
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
