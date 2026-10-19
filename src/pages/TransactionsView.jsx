import { useState, useEffect, useCallback } from "react";
import PageShell from "../components/layout/PageShell";
import {
  fetchTransactions,
  initiateTransaction,
  fetchSnapshot,
  connectTransactionSocket,
} from "../api";
import {
  Zap,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Radio,
  Layers,
  Shield,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  ExternalLink,
} from "lucide-react";

const INR_FORMAT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function TransactionsView() {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connStatus, setConnStatus] = useState("connecting");

  // Form State
  const [senderId, setSenderId] = useState("user1@upi");
  const [receiverId, setReceiverId] = useState("user2@upi");
  const [amount, setAmount] = useState(500);
  const [mode, setMode] = useState("rest");
  const [paying, setPaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  // Result & Error
  const [activeTxn, setActiveTxn] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const [txns, snap] = await Promise.all([
        fetchTransactions().catch(() => []),
        fetchSnapshot().catch(() => null),
      ]);
      setTransactions(txns || []);
      if (snap?.accounts) setAccounts(snap.accounts);
      if (!activeTxn && txns && txns.length > 0) {
        setActiveTxn(txns[0]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeTxn]);

  useEffect(() => {
    loadData();
    const ws = connectTransactionSocket(() => loadData(), setConnStatus);
    return () => ws.close();
  }, [loadData]);

  // Sender current balance
  const senderAccount = accounts.find((a) => a.upi_id === senderId || a.id === senderId);
  const receiverAccount = accounts.find((a) => a.upi_id === receiverId || a.id === receiverId);

  // Validation
  const isSelfTransfer = senderId === receiverId;
  const isAmountValid = Number(amount) > 0;
  const hasSufficientFunds = senderAccount ? senderAccount.balance >= Number(amount) : true;
  const canSubmit = isAmountValid && !isSelfTransfer && hasSufficientFunds && !paying;

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    if (!canSubmit) return;

    setErrorMsg("");
    setPaying(true);
    setCurrentStep(1);

    // Simulated progress stepper sequence while initiating
    const t1 = setTimeout(() => setCurrentStep(2), 300);
    const t2 = setTimeout(() => setCurrentStep(3), 600);
    const t3 = setTimeout(() => setCurrentStep(4), 900);

    try {
      const res = await initiateTransaction({
        senderId,
        receiverId,
        amount: Number(amount),
        mode,
      });
      setCurrentStep(5);
      setActiveTxn(res);
      await loadData();
    } catch (err) {
      setErrorMsg(err.message || "Payment execution failed");
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      setPaying(false);
    }
  }

  const handleCopy = (id) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <PageShell connStatus={connStatus}>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="unit-tag">Payment Orchestration Console</div>
          <h1 className="page-title">Make UPI Transaction</h1>
          <p className="page-subtitle">
            Initiate real-time interbank fund transfers across distributed core banking nodes, validate balance invariants, and inspect the 5-step Saga execution progress.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={loadData}
            title="Refresh Account Balances"
          >
            <Clock size={13} style={{ color: "var(--upi-green)" }} />
            <span>Refresh Balances</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Form Left, Result / Progress Right */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "22px", marginBottom: "26px" }}>
        {/* Left Card: Transaction Initiation Form */}
        <div className="card-clean">
          <div className="card-header-bar">
            <div className="card-title">
              <Zap size={18} style={{ color: "var(--upi-orange)" }} />
              <span>Initiate UPI Transfer</span>
            </div>
            <span className="status-pill success">Live Gateway</span>
          </div>

          {/* Quick Party Presets */}
          <div style={{ marginBottom: "14px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase" }}>
              Presets:
            </span>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.74rem", padding: "3px 8px", minHeight: "26px", background: senderId === "user1@upi" && receiverId === "user2@upi" ? "var(--upi-orange-tint)" : undefined }}
              onClick={() => {
                setSenderId("user1@upi");
                setReceiverId("user2@upi");
              }}
            >
              User 1 &rarr; User 2
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.74rem", padding: "3px 8px", minHeight: "26px", background: senderId === "user2@upi" && receiverId === "user1@upi" ? "var(--upi-orange-tint)" : undefined }}
              onClick={() => {
                setSenderId("user2@upi");
                setReceiverId("user1@upi");
              }}
            >
              User 2 &rarr; User 1
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.74rem", padding: "3px 8px", minHeight: "26px", background: senderId === "sanika@bank" && receiverId === "navya@bank" ? "var(--upi-orange-tint)" : undefined }}
              onClick={() => {
                setSenderId("sanika@bank");
                setReceiverId("navya@bank");
              }}
            >
              Sanika &rarr; Navya
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.74rem", padding: "3px 8px", minHeight: "26px" }}
              onClick={() => {
                const temp = senderId;
                setSenderId(receiverId);
                setReceiverId(temp);
              }}
            >
              &harr; Swap
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* Sender and Receiver Fields */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div className="form-group">
                <label className="form-label">
                  Remitter VPA (Sender)
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  placeholder="user1@upi"
                  required
                />
                {senderAccount && (
                  <span style={{ fontSize: "0.72rem", color: "var(--upi-green)", fontWeight: 600 }}>
                    Balance: <strong className="tabular-nums">{INR_FORMAT.format(senderAccount.balance)}</strong> ({senderAccount.bank_name})
                  </span>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">
                  Beneficiary VPA (Receiver)
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={receiverId}
                  onChange={(e) => setReceiverId(e.target.value)}
                  placeholder="user2@upi"
                  required
                />
                {receiverAccount && (
                  <span style={{ fontSize: "0.72rem", color: "var(--ink-muted)", fontWeight: 500 }}>
                    Bank: {receiverAccount.bank_name}
                  </span>
                )}
              </div>
            </div>

            {/* Amount and Protocol Mode */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div className="form-group">
                <label className="form-label">Amount (INR &bull; ₹)</label>
                <input
                  type="number"
                  className="form-input"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  min="1"
                  max="100000"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Communication Protocol</label>
                <select
                  className="form-select"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="rest">REST (HTTP/1.1 Standard)</option>
                  <option value="grpc">gRPC (HTTP/2 Protocol Buffer)</option>
                  <option value="ws">WebSocket (Bidirectional Stream)</option>
                  <option value="p2p">P2P (WebRTC DataChannel)</option>
                  <option value="rabbitmq">RabbitMQ (AMQP Event Exchange)</option>
                </select>
              </div>
            </div>

            {/* Validation Feedback */}
            {isSelfTransfer && (
              <div style={{ padding: "8px 12px", background: "var(--amber-tint)", border: "1px solid var(--amber-border)", borderRadius: "6px", fontSize: "0.76rem", color: "var(--amber)", display: "flex", alignItems: "center", gap: "6px" }}>
                <AlertTriangle size={14} />
                <span>Remitter and Beneficiary VPAs cannot be identical.</span>
              </div>
            )}

            {!hasSufficientFunds && (
              <div style={{ padding: "8px 12px", background: "var(--crimson-tint)", border: "1px solid var(--crimson-border)", borderRadius: "6px", fontSize: "0.76rem", color: "var(--crimson)", display: "flex", alignItems: "center", gap: "6px" }}>
                <AlertTriangle size={14} />
                <span>Insufficient balance! Amount ₹{amount} exceeds remitter balance ₹{senderAccount?.balance}.</span>
              </div>
            )}

            {errorMsg && (
              <div style={{ padding: "8px 12px", background: "var(--crimson-tint)", border: "1px solid var(--crimson-border)", borderRadius: "6px", fontSize: "0.76rem", color: "var(--crimson)", display: "flex", alignItems: "center", gap: "6px" }}>
                <AlertTriangle size={14} />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              className="btn-primary"
              disabled={!canSubmit}
              style={{ marginTop: "6px", width: "100%", justifyContent: "center" }}
            >
              {paying ? (
                <>
                  <Zap size={14} className="spin" />
                  <span>Orchestrating Transfer...</span>
                </>
              ) : (
                <>
                  <Zap size={14} />
                  <span>Execute Payment &bull; {INR_FORMAT.format(amount || 0)}</span>
                </>
              )}
            </button>
          </form>

          {/* Protocol Explanatory Note */}
          <div style={{ marginTop: "14px", padding: "10px", background: "var(--bg-subtle)", borderRadius: "6px", fontSize: "0.74rem", color: "var(--ink-secondary)", lineHeight: 1.45 }}>
            <strong>Selected Route:</strong> {mode === "grpc" ? "High-performance binary Proto stubs to port 50051." : mode === "rabbitmq" ? "Asynchronous publish-subscribe via topic exchange." : mode === "p2p" ? "Direct WebRTC DataChannel bypass." : "Standard REST interbank API gateway."}
          </div>
        </div>

        {/* Right Card: Real-Time Transaction Progress & Active Result */}
        <div className="card-clean">
          <div className="card-header-bar">
            <div className="card-title">
              <CheckCircle2 size={18} style={{ color: "var(--upi-green)" }} />
              <span>Orchestration Progress &amp; Result</span>
            </div>
            {activeTxn && (
              <span className={`status-pill ${activeTxn.status === "SUCCESS" ? "success" : activeTxn.status === "FAILED" ? "danger" : "warning"}`}>
                {activeTxn.status}
              </span>
            )}
          </div>

          {/* 5-Step Saga Progress Stepper */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", marginBottom: "8px" }}>
              Saga Execution Steps:
            </div>
            <div className="stepper-container" style={{ margin: 0 }}>
              {[
                { num: 1, title: "Authorize" },
                { num: 2, title: "Debit HDFC" },
                { num: 3, title: "NPCI Switch" },
                { num: 4, title: "Credit ICICI" },
                { num: 5, title: "Commit" },
              ].map((s) => {
                const isDone = (paying ? currentStep > s.num : activeTxn?.status === "SUCCESS");
                const isCurrent = paying && currentStep === s.num;

                return (
                  <div key={s.num} className={`step-item ${isCurrent ? "active" : isDone ? "completed" : ""}`}>
                    <div className="step-circle">{isDone ? <Check size={12} /> : s.num}</div>
                    <span style={{ fontSize: "0.72rem" }}>{s.title}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Transaction Result Details */}
          {activeTxn ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ padding: "12px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-sm)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "0.72rem", color: "var(--ink-muted)", textTransform: "uppercase" }}>Transaction Reference</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <code style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--ink-primary)" }}>{activeTxn.transactionId}</code>
                    <button
                      type="button"
                      onClick={() => handleCopy(activeTxn.transactionId)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: copiedId === activeTxn.transactionId ? "var(--upi-green)" : "var(--ink-muted)" }}
                      title="Copy ID"
                    >
                      {copiedId === activeTxn.transactionId ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "0.8rem" }}>
                  <div>
                    <span style={{ fontSize: "0.7rem", color: "var(--ink-muted)" }}>Remitter:</span>
                    <div style={{ fontWeight: 600, color: "var(--upi-orange)" }}>{activeTxn.senderId}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.7rem", color: "var(--ink-muted)" }}>Beneficiary:</span>
                    <div style={{ fontWeight: 600, color: "var(--upi-green)" }}>{activeTxn.receiverId}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.7rem", color: "var(--ink-muted)" }}>Settled Amount:</span>
                    <div className="tabular-nums" style={{ fontWeight: 700, fontSize: "0.95rem" }}>{INR_FORMAT.format(activeTxn.amount)}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.7rem", color: "var(--ink-muted)" }}>Protocol Mode:</span>
                    <div style={{ fontWeight: 600, textTransform: "uppercase" }}>{activeTxn.mode}</div>
                  </div>
                </div>
              </div>

              {/* Event Timeline Trace */}
              {activeTxn.timeline && activeTxn.timeline.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", marginBottom: "6px" }}>
                    Distributed Event Trace:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto" }}>
                    {activeTxn.timeline.map((evt, eIdx) => (
                      <div
                        key={eIdx}
                        style={{
                          padding: "6px 10px",
                          background: "#FFFFFF",
                          border: "1px solid var(--border-hairline)",
                          borderRadius: "4px",
                          fontSize: "0.74rem",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ color: "var(--upi-orange)", fontWeight: 700 }}>{evt.service || "Switch"}:</span>
                          <span>{evt.message || evt.event}</span>
                        </div>
                        {evt.lamport && (
                          <span className="tabular-nums" style={{ color: "var(--ink-muted)", fontSize: "0.68rem" }}>
                            L={evt.lamport}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "28px 16px", color: "var(--ink-muted)", fontSize: "0.82rem" }}>
              Submit a transfer using the form to trace live Saga orchestration.
            </div>
          )}
        </div>
      </div>

      {/* Recent Transactions List */}
      <div className="card-clean" style={{ padding: 0 }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-hairline)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, color: "var(--ink-primary)" }}>
            Recent Processed Transactions ({transactions.length})
          </h3>
          <span style={{ fontSize: "0.75rem", color: "var(--ink-muted)" }}>
            Persisted in SQLite database
          </span>
        </div>

        <div className="table-container" style={{ border: "none" }}>
          <table className="fintech-table">
            <thead>
              <tr>
                <th>Txn ID</th>
                <th>Remitter</th>
                <th>Beneficiary</th>
                <th>Amount</th>
                <th>Protocol</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 8).map((t) => (
                <tr
                  key={t.transactionId}
                  onClick={() => setActiveTxn(t)}
                  style={{ cursor: "pointer", background: activeTxn?.transactionId === t.transactionId ? "var(--upi-orange-tint)" : undefined }}
                >
                  <td>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", fontWeight: 700 }}>
                      {t.transactionId}
                    </span>
                  </td>
                  <td><span style={{ fontSize: "0.8rem" }}>{t.senderId}</span></td>
                  <td><span style={{ fontSize: "0.8rem" }}>{t.receiverId}</span></td>
                  <td><strong className="tabular-nums" style={{ fontSize: "0.84rem" }}>{INR_FORMAT.format(t.amount)}</strong></td>
                  <td><span style={{ fontSize: "0.74rem", textTransform: "uppercase" }}>{t.mode}</span></td>
                  <td>
                    <span className={`status-pill ${t.status === "SUCCESS" ? "success" : t.status === "FAILED" ? "danger" : "warning"}`}>
                      {t.status}
                    </span>
                  </td>
                  <td>
                    <span className="tabular-nums" style={{ fontSize: "0.74rem", color: "var(--ink-muted)" }}>
                      {t.createdAt ? new Date(t.createdAt).toLocaleTimeString() : "--"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}
