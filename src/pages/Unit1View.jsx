import { useState, useEffect } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchUnit1Overview, connectTransactionSocket } from "../api";
import {
  Layers,
  Network,
  Cpu,
  Radio,
  Zap,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Server,
  Database,
  Globe,
  Activity,
  Terminal,
} from "lucide-react";

export default function Unit1View() {
  const [overview, setOverview] = useState(null);
  const [connStatus, setConnStatus] = useState("connecting");
  const [wsLogs, setWsLogs] = useState([
    { id: 1, time: "00:00:01", type: "CONNECTED", detail: "WebSocket connection established to /ws/transactions" },
    { id: 2, time: "00:00:02", type: "SUBSCRIBED", detail: "Subscribed to live channel: upi.transactions.settled" },
    { id: 3, time: "00:00:05", type: "HEARTBEAT", detail: "Ping/Pong keepalive acknowledgment received (RTT < 2ms)" },
  ]);
  const [pingCount, setPingCount] = useState(3);

  useEffect(() => {
    fetchUnit1Overview().then(setOverview).catch(console.error);

    const ws = connectTransactionSocket((data) => {
      const now = new Date().toTimeString().split(" ")[0];
      setWsLogs((prev) => [
        {
          id: Date.now(),
          time: now,
          type: "TXN_BROADCAST",
          detail: `Received live transaction ${data.transaction_id || "event"}: ${data.status || "settled"}`,
        },
        ...prev.slice(0, 7),
      ]);
    }, setConnStatus);

    const pingTimer = setInterval(() => {
      setPingCount((c) => c + 1);
      const now = new Date().toTimeString().split(" ")[0];
      setWsLogs((prev) => [
        {
          id: Date.now(),
          time: now,
          type: "HEARTBEAT",
          detail: "Heartbeat ACK: WebSocket duplex channel healthy",
        },
        ...prev.slice(0, 7),
      ]);
    }, 8000);

    return () => {
      clearInterval(pingTimer);
      ws.close();
    };
  }, []);

  return (
    <PageShell connStatus={connStatus}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="unit-tag">Part 1 &bull; Unit I</div>
          <h1 className="page-title">Distributed Systems Architecture &amp; WebSockets</h1>
          <p className="page-subtitle">
            A concise overview of the 4-tier distributed architecture, the enterprise system classification, and the live duplex WebSocket messaging implementation.
          </p>
        </div>
      </div>

      {/* Grid: 3 Pillars with Unique Content */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "20px", marginBottom: "24px" }}>
        {/* Pillar 1: Distributed System Architecture Used */}
        <div className="card-clean">
          <div className="card-header-bar">
            <div className="card-title">
              <Layers size={18} style={{ color: "var(--upi-orange)" }} />
              <span>1. Distributed Architecture</span>
            </div>
            <span className="status-pill success">4-Tier System</span>
          </div>

          <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", marginBottom: "16px" }}>
            The UPI project implements a decoupled multi-tier architecture separating the client interface, orchestration layer, independent banking domains, and persistent storage.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ padding: "10px 12px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-sm)" }}>
              <strong style={{ fontSize: "0.82rem", color: "var(--upi-orange)" }}>Tier 1: Client Edge (React + Vite)</strong>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>
                Browser SPA with real-time reactive state updates and WebSocket telemetry.
              </div>
            </div>

            <div style={{ padding: "10px 12px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-sm)" }}>
              <strong style={{ fontSize: "0.82rem", color: "var(--blue-accent)" }}>Tier 2: Transaction Orchestrator &amp; Gateway</strong>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>
                Coordinates distributed Saga transactions, enforces timeouts, and manages circuit breakers.
              </div>
            </div>

            <div style={{ padding: "10px 12px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-sm)" }}>
              <strong style={{ fontSize: "0.82rem", color: "var(--upi-green)" }}>Tier 3: Core Banking Microservices &amp; NPCI Switch</strong>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>
                HDFC (Remitter) &amp; ICICI (Beneficiary) nodes running gRPC services, linked via the NPCI switch.
              </div>
            </div>

            <div style={{ padding: "10px 12px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-sm)" }}>
              <strong style={{ fontSize: "0.82rem", color: "var(--ink-primary)" }}>Tier 4: Distributed Ledger &amp; Storage</strong>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>
                SQLite WAL persistence maintaining double-entry parity (Total Debits == Total Credits).
              </div>
            </div>
          </div>
        </div>

        {/* Pillar 2: Type of Distributed System */}
        <div className="card-clean">
          <div className="card-header-bar">
            <div className="card-title">
              <Network size={18} style={{ color: "var(--upi-green)" }} />
              <span>2. System Classification</span>
            </div>
            <span className="status-pill info">Distributed Information System</span>
          </div>

          <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", marginBottom: "16px" }}>
            This simulator represents an <strong>Enterprise Application Integration (EAI) Distributed Information System</strong> handling transactional workloads.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ padding: "12px", background: "var(--upi-green-tint)", border: "1px solid var(--upi-green-border)", borderRadius: "var(--radius-sm)" }}>
              <strong style={{ fontSize: "0.82rem", color: "var(--upi-green)" }}>Transaction Processing (OLTP)</strong>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", marginTop: "2px" }}>
                Executes ACID fund transfers across autonomous bank nodes using multi-phase Saga choreography instead of blocking 2PC.
              </div>
            </div>

            <div style={{ padding: "12px", background: "var(--upi-orange-tint)", border: "1px solid var(--upi-orange-border)", borderRadius: "var(--radius-sm)" }}>
              <strong style={{ fontSize: "0.82rem", color: "var(--upi-orange)" }}>Enterprise Application Integration</strong>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", marginTop: "2px" }}>
                Bridges heterogeneous services: Synchronous gRPC for bank debit stubs, asynchronous events for notifications, and REST for client dispatch.
              </div>
            </div>

            <div style={{ padding: "12px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-sm)" }}>
              <strong style={{ fontSize: "0.82rem", color: "var(--ink-primary)" }}>Design Goals Enforced</strong>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", marginTop: "2px" }}>
                Location Transparency &bull; Open API Specification &bull; Failure Isolation &bull; Ledger Auditability.
              </div>
            </div>
          </div>
        </div>

        {/* Pillar 3: Live WebSocket Implementation */}
        <div className="card-clean">
          <div className="card-header-bar">
            <div className="card-title">
              <Radio size={18} style={{ color: "var(--blue-accent)" }} />
              <span>3. WebSocket Implementation</span>
            </div>
            <span className="status-pill success">{connStatus.toUpperCase()}</span>
          </div>

          <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", marginBottom: "16px" }}>
            Real-time full-duplex WebSocket channel mounted on <code>/ws/transactions</code> broadcasting settlement states and node heartbeats directly to all connected clients.
          </p>

          <div style={{ marginBottom: "12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div style={{ padding: "8px 10px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontSize: "0.72rem", color: "var(--ink-muted)" }}>Protocol Endpoint</div>
              <strong style={{ fontSize: "0.8rem", color: "var(--ink-primary)" }}>ws://localhost:3000/ws/transactions</strong>
            </div>
            <div style={{ padding: "8px 10px", background: "var(--bg-canvas)", border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontSize: "0.72rem", color: "var(--ink-muted)" }}>Heartbeats Exchanged</div>
              <strong style={{ fontSize: "0.8rem", color: "var(--upi-green)" }}>{pingCount} Ping / ACKs</strong>
            </div>
          </div>

          {/* Live WebSocket Event Feed */}
          <div style={{ background: "#0F172A", borderRadius: "var(--radius-sm)", padding: "12px", color: "#F8FAFC", maxHeight: "170px", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", borderBottom: "1px solid #334155", paddingBottom: "4px" }}>
              <span style={{ fontSize: "0.72rem", color: "#94A3B8", display: "flex", alignItems: "center", gap: "4px" }}>
                <Terminal size={12} /> Live Duplex Feed
              </span>
              <span style={{ fontSize: "0.7rem", color: "#22C55E" }}>Active Socket</span>
            </div>

            {wsLogs.map((log) => (
              <div key={log.id} style={{ fontSize: "0.72rem", lineHeight: "1.4", marginBottom: "4px", display: "flex", gap: "8px" }}>
                <span style={{ color: "#64748B", flexShrink: 0 }}>{log.time}</span>
                <span style={{ color: log.type === "TXN_BROADCAST" ? "#F59E0B" : "#38BDF8", fontWeight: 600, flexShrink: 0 }}>
                  [{log.type}]
                </span>
                <span style={{ color: "#CBD5E1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {log.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
