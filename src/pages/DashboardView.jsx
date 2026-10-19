import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import PageShell from "../components/layout/PageShell";
import ServiceNetworkCanvas from "../components/dashboard/ServiceNetworkCanvas";
import {
  fetchSnapshot,
  connectTransactionSocket,
  initiateTransaction,
} from "../api";
import {
  CreditCard,
  Activity,
  CheckCircle2,
  AlertCircle,
  Play,
  RefreshCw,
  Zap,
  X,
  ArrowRight,
} from "lucide-react";

export default function DashboardView() {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState(null);
  const [connStatus, setConnStatus] = useState("connecting");
  const [refreshing, setRefreshing] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [flowState, setFlowState] = useState("idle"); // "idle" | "processing" | "success" | "failed"
  const [lastNotification, setLastNotification] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const snap = await fetchSnapshot();
      setSnapshot(snap);
    } catch (e) {
      console.error("Failed to load snapshot:", e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000);

    const ws = connectTransactionSocket((event) => {
      loadData();

      // Listen for live transaction stream events
      if (
        event?.event === "TRANSACTION_INITIATED" ||
        event?.event === "P2P_REQUEST_STARTED"
      ) {
        setFlowState("processing");
      } else if (event?.event === "PAYMENT_SUCCESS") {
        setFlowState("success");
        setLastNotification({
          type: "success",
          title: "Transaction Settled",
          id: event.transactionId,
          message: event.message || "Payment completed across distributed nodes",
          timestamp: new Date().toLocaleTimeString(),
        });
        setTimeout(() => setFlowState("idle"), 4000);
      } else if (
        event?.event === "TRANSACTION_FAILED" ||
        event?.event === "ROLLBACK_COMPLETED"
      ) {
        setFlowState("failed");
        setLastNotification({
          type: "error",
          title: "Transaction Failed",
          id: event.transactionId,
          message: event.reason || event.message || "Transaction aborted or rolled back",
          timestamp: new Date().toLocaleTimeString(),
        });
        setTimeout(() => setFlowState("idle"), 4000);
      }
    }, setConnStatus);

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [loadData]);

  // Handle simulating a live transaction to trigger the animated network flow
  const handleSimulateFlow = async () => {
    if (isSimulating) return;
    setIsSimulating(true);
    setFlowState("processing");

    try {
      // Pick test users Sanika (HDFC) -> Navya (ICICI)
      const res = await initiateTransaction({
        senderId: "usr_sanika",
        receiverId: "usr_navya",
        amount: Math.floor(Math.random() * 200) + 50,
        mode: "rest",
      });

      if (res.status === "SUCCESS") {
        setFlowState("success");
        setLastNotification({
          type: "success",
          title: "Transaction Settled",
          id: res.transactionId,
          message: `₹${res.amount || 100} settled from Sanika (HDFC) to Navya (ICICI)`,
          timestamp: new Date().toLocaleTimeString(),
        });
      } else {
        setFlowState("failed");
        setLastNotification({
          type: "error",
          title: "Transaction Failed",
          id: res.transactionId,
          message: res.failureReason || "Transaction failed",
          timestamp: new Date().toLocaleTimeString(),
        });
      }
      await loadData();
    } catch (err) {
      setFlowState("failed");
      setLastNotification({
        type: "error",
        title: "Simulation Failed",
        id: "ERR",
        message: err.message,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setIsSimulating(false);
      setTimeout(() => {
        setFlowState((curr) => (curr !== "processing" ? "idle" : curr));
      }, 4500);
    }
  };

  const handleManualRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const stats = snapshot?.stats || {
    total: 0,
    successful: 0,
    failed: 0,
    processing: 0,
  };

  return (
    <PageShell connStatus={connStatus}>
      {/* Transaction Completion Feedback Notification (Toast) */}
      {lastNotification && (
        <div
          style={{
            position: "fixed",
            bottom: "28px",
            right: "28px",
            zIndex: 9999,
            background: "#FFFFFF",
            border: `1.5px solid ${
              lastNotification.type === "success"
                ? "var(--upi-green)"
                : "var(--crimson)"
            }`,
            borderRadius: "var(--radius-md)",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.12)",
            padding: "14px 18px",
            maxWidth: "380px",
            width: "calc(100vw - 48px)",
          }}
          className="toast-enter"
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  background:
                    lastNotification.type === "success"
                      ? "var(--upi-green-tint)"
                      : "var(--crimson-tint)",
                  color:
                    lastNotification.type === "success"
                      ? "var(--upi-green)"
                      : "var(--crimson)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: "2px",
                }}
              >
                {lastNotification.type === "success" ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <AlertCircle size={16} />
                )}
              </div>
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <strong
                    style={{
                      fontSize: "0.88rem",
                      color: "var(--ink-primary)",
                    }}
                  >
                    {lastNotification.title}
                  </strong>
                  <span
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--ink-muted)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {lastNotification.timestamp}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--ink-secondary)",
                    margin: "2px 0 4px",
                  }}
                >
                  {lastNotification.message}
                </div>
                {lastNotification.id && (
                  <div
                    style={{
                      fontSize: "0.70rem",
                      color: "var(--ink-muted)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    ID: {lastNotification.id}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setLastNotification(null)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--ink-muted)",
                padding: "2px",
              }}
              title="Dismiss notification"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div
        className="page-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "18px",
        }}
      >
        <div>
          <div className="unit-tag">Live Service Network</div>
          <h1
            className="page-title"
            style={{ fontSize: "1.65rem", margin: "2px 0 4px" }}
          >
            UPI Distributed Systems Dashboard
          </h1>
          <p
            className="page-subtitle"
            style={{ fontSize: "0.85rem", color: "var(--ink-muted)", margin: 0 }}
          >
            Interactive service-network topology, real-time protocols, and live transaction flow.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleManualRefresh}
            disabled={refreshing}
            style={{ fontSize: "0.82rem", padding: "7px 13px" }}
            title="Refresh network telemetry"
          >
            <RefreshCw
              size={13}
              className={refreshing ? "spin" : ""}
              style={{ color: "var(--upi-green)" }}
            />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleSimulateFlow}
            disabled={isSimulating}
            style={{
              fontSize: "0.82rem",
              padding: "7px 13px",
              borderColor: "var(--upi-orange-border)",
              color: "var(--upi-orange)",
              background: "var(--upi-orange-tint)",
            }}
            title="Simulate live transaction flow on network"
          >
            <Play
              size={13}
              className={isSimulating ? "spin" : ""}
              style={{ color: "var(--upi-orange)" }}
            />
            <span>{isSimulating ? "Transacting..." : "Simulate Flow"}</span>
          </button>

          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate("/transactions")}
            style={{ fontSize: "0.82rem", padding: "7px 14px" }}
            title="Initiate custom payment"
          >
            <Zap size={13} />
            <span>Make Transaction</span>
          </button>
        </div>
      </div>

      {/* Top Strip: Exactly 3 Metrics (Total Transactions, Successful Transactions, Failed Transactions) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "14px",
          marginBottom: "18px",
        }}
      >
        {/* Metric 1: Total Transactions */}
        <div
          className="kpi-tile kpi-orange"
          style={{
            padding: "14px 18px",
            borderRadius: "var(--radius-md)",
            background: "#FFFFFF",
            border: "1.5px solid var(--upi-orange-border)",
            borderLeft: "4px solid var(--upi-orange)",
            boxShadow: "0 2px 10px rgba(255, 102, 0, 0.05)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "var(--upi-orange)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: "4px",
            }}
          >
            <CreditCard size={15} style={{ color: "var(--upi-orange)" }} />
            Total Transactions
          </div>
          <div
            style={{
              fontSize: "1.85rem",
              fontWeight: 800,
              color: "var(--ink-primary)",
              lineHeight: 1.1,
            }}
            className="tabular-nums"
          >
            {stats.total}
          </div>
          <div
            style={{
              fontSize: "0.74rem",
              color: "var(--ink-muted)",
              marginTop: "4px",
            }}
          >
            Recorded in distributed ledger
          </div>
        </div>

        {/* Metric 2: Successful Transactions */}
        <div
          className="kpi-tile kpi-green"
          style={{
            padding: "14px 18px",
            borderRadius: "var(--radius-md)",
            background: "#FFFFFF",
            border: "1.5px solid var(--upi-green-border)",
            borderLeft: "4px solid var(--upi-green)",
            boxShadow: "0 2px 10px rgba(0, 135, 90, 0.05)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "var(--upi-green)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: "4px",
            }}
          >
            <CheckCircle2 size={15} style={{ color: "var(--upi-green)" }} />
            Successful Transactions
          </div>
          <div
            style={{
              fontSize: "1.85rem",
              fontWeight: 800,
              color: "var(--upi-green)",
              lineHeight: 1.1,
            }}
            className="tabular-nums"
          >
            {stats.successful}
          </div>
          <div
            style={{
              fontSize: "0.74rem",
              color: "var(--ink-muted)",
              marginTop: "4px",
            }}
          >
            Committed atomic debit &amp; credit
          </div>
        </div>

        {/* Metric 3: Failed Transactions */}
        <div
          className="kpi-tile"
          style={{
            padding: "14px 18px",
            borderRadius: "var(--radius-md)",
            background: "#FFFFFF",
            border:
              stats.failed > 0
                ? "1.5px solid var(--crimson-border)"
                : "1.5px solid var(--border-hairline)",
            borderLeft:
              stats.failed > 0
                ? "4px solid var(--crimson)"
                : "4px solid var(--ink-muted)",
            boxShadow:
              stats.failed > 0
                ? "0 2px 10px rgba(220, 38, 38, 0.08)"
                : "0 2px 10px rgba(0, 0, 0, 0.03)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "0.78rem",
              fontWeight: 700,
              color:
                stats.failed > 0 ? "var(--crimson)" : "var(--ink-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: "4px",
            }}
          >
            <AlertCircle
              size={15}
              style={{
                color:
                  stats.failed > 0 ? "var(--crimson)" : "var(--ink-muted)",
              }}
            />
            Failed Transactions
          </div>
          <div
            style={{
              fontSize: "1.85rem",
              fontWeight: 800,
              color:
                stats.failed > 0 ? "var(--crimson)" : "var(--ink-primary)",
              lineHeight: 1.1,
            }}
            className="tabular-nums"
          >
            {stats.failed}
          </div>
          <div
            style={{
              fontSize: "0.74rem",
              color: "var(--ink-muted)",
              marginTop: "4px",
            }}
          >
            Compensated by Saga rollback
          </div>
        </div>
      </div>

      {/* Main Architecture Canvas: Tree of Connected Services */}
      <ServiceNetworkCanvas
        healthData={snapshot?.health || {}}
        flowState={flowState}
      />
    </PageShell>
  );
}
