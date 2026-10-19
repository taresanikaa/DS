import React, { useState } from "react";
import {
  Globe,
  Workflow,
  Building2,
  Cpu,
  Layers,
  Database,
  CheckCircle2,
  AlertCircle,
  Activity,
  X,
  Radio,
  ArrowDown,
  ArrowUp,
  ArrowRight,
  ExternalLink,
  Shield,
  Clock,
  Zap,
} from "lucide-react";

export default function ServiceNetworkCanvas({
  healthData = {},
  flowState = "idle", // "idle" | "processing" | "success" | "failed"
  activeTransaction = null,
  onServiceSelect = null,
}) {
  const [selectedService, setSelectedService] = useState(null);
  const [probeResult, setProbeResult] = useState(null);
  const [probing, setProbing] = useState(false);

  // Exact 5 services matching the implemented architecture
  const services = [
    {
      id: "client",
      name: "USER CLIENT",
      subtitle: "Payer Application (Web / Mobile)",
      tier: 1,
      port: "3000 (HTTPS/WSS)",
      icon: Globe,
      color: "var(--upi-orange)",
      role: "Client frontend initiating UPI payments, providing VPA verification, and receiving settlement confirmation via WebSocket.",
      database: "Client Session / Local Storage & Secure PIN Cache",
      healthUrl: "/health",
      healthKey: "client",
      protocol: "REST (HTTP/1.1) & WSS WebSocket",
      endpoint: "POST /api/transaction/initiate",
      badge: "Payer Interface",
    },
    {
      id: "coordinator",
      name: "TRANSACTION SERVICE",
      subtitle: "Main Coordinator & Saga Orchestrator",
      tier: 2,
      port: "8000 / 3000",
      icon: Workflow,
      color: "var(--upi-green)",
      role: "Central API gateway and distributed transaction coordinator managing two-phase saga commits, idempotency, and Lamport logical clocks.",
      database: "SQLite WAL (:data/upi_simulator.db) & Event Log",
      healthUrl: "/health",
      healthKey: "transaction-service",
      protocol: "REST / HTTP/2 & WebSocket Broadcast",
      endpoint: "POST /api/transaction/initiate",
      badge: "Saga Orchestrator",
    },
    {
      id: "npci",
      name: "NPCI SWITCH",
      subtitle: "National Interbank Switch Simulator",
      tier: 3,
      port: "8002",
      icon: Cpu,
      color: "var(--upi-green)",
      role: "National Payments Corporation of India switch routing clearing instructions between sender (remitter) and beneficiary banks with sub-50ms latency.",
      database: "In-Memory VPA Routing Directory & Clearing Ledger",
      healthUrl: "/services/npci/health",
      healthKey: "npci",
      protocol: "ISO 8583 / REST Clearing Dispatch",
      endpoint: "POST /services/npci/route",
      badge: "Interbank Switch",
    },
    {
      id: "sender-bank",
      name: "SENDER BANK",
      subtitle: "HDFC Core Banking (CBS)",
      tier: 4,
      position: "left",
      port: "8001 / 50051",
      icon: Building2,
      color: "var(--upi-orange)",
      role: "Remitter core banking system verifying funds availability, acquiring account-level lock, and executing atomic debit hold.",
      database: "HDFC Bank Shard / SQLite WAL (Master Balances)",
      healthUrl: "/services/sender-bank/health",
      healthKey: "sender-bank",
      protocol: "REST & gRPC Protobuf v3",
      endpoint: "POST /services/sender-bank/debit",
      badge: "Remitter Bank",
    },
    {
      id: "receiver-bank",
      name: "RECEIVER BANK",
      subtitle: "ICICI Core Banking (CBS)",
      tier: 4,
      position: "right",
      port: "8003 / 50051",
      icon: Building2,
      color: "var(--upi-orange)",
      role: "Beneficiary core banking system verifying account validity and committing atomic credit deposit.",
      database: "ICICI Bank Shard / SQLite WAL (Beneficiary Accounts)",
      healthUrl: "/services/receiver-bank/health",
      healthKey: "receiver-bank",
      protocol: "REST & gRPC Protobuf v3",
      endpoint: "POST /services/receiver-bank/credit",
      badge: "Beneficiary Bank",
    },
  ];

  const getServiceHealth = (svc) => {
    if (svc.id === "client") return { status: "healthy", label: "CONNECTED" };
    const backendH = healthData[svc.healthKey];
    if (backendH) {
      return {
        status: backendH.status || "healthy",
        label: (backendH.status || "healthy").toUpperCase(),
      };
    }
    return { status: "healthy", label: "HEALTHY" };
  };

  const handleCardClick = (svc) => {
    setSelectedService(svc);
    setProbeResult(null);
    if (onServiceSelect) onServiceSelect(svc);
  };

  const handleProbe = async (svc) => {
    setProbing(true);
    const start = performance.now();
    try {
      const res = await fetch(svc.healthUrl);
      const data = await res.json();
      const latency = Math.round(performance.now() - start);
      setProbeResult({
        success: res.ok,
        status: res.status,
        latencyMs: latency,
        data,
      });
    } catch (err) {
      setProbeResult({
        success: false,
        status: "ERR",
        latencyMs: Math.round(performance.now() - start),
        error: err.message,
      });
    } finally {
      setProbing(false);
    }
  };

  const isProcessing = flowState === "processing";
  const isSuccess = flowState === "success";
  const isFailed = flowState === "failed";

  // Dynamic flow colors
  const primaryLineColor = isProcessing
    ? "var(--upi-orange)"
    : isSuccess
    ? "var(--upi-green)"
    : isFailed
    ? "var(--crimson)"
    : "#00875A";

  const primaryMarkerId = isProcessing
    ? "arrow-down-orange"
    : isSuccess
    ? "arrow-down-green"
    : isFailed
    ? "arrow-down-crimson"
    : "arrow-down-green";

  const primaryLineClass = isProcessing
    ? "flow-anim-orange"
    : isSuccess
    ? "flow-anim-green"
    : isFailed
    ? "flow-anim-crimson"
    : "";

  const responseLineColor = isSuccess
    ? "var(--upi-green)"
    : isProcessing
    ? "var(--upi-orange)"
    : "rgba(100, 116, 139, 0.4)";

  const responseMarkerId = isSuccess
    ? "arrow-up-green"
    : isProcessing
    ? "arrow-up-orange"
    : "arrow-up-idle";

  const responseLineClass = isSuccess
    ? "flow-anim-green"
    : isProcessing
    ? "flow-anim-orange"
    : "";

  return (
    <div
      style={{
        position: "relative",
        background: "var(--bg-surface)",
        border: "1.5px solid var(--upi-green-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.04)",
        padding: "16px 20px 20px",
        overflow: "hidden",
      }}
    >
      {/* Background Subtle Micro-Grid */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(0, 135, 90, 0.04) 1px, transparent 0)",
          backgroundSize: "22px 22px",
          pointerEvents: "none",
          opacity: 0.9,
        }}
      />

      {/* Canvas Top Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: isProcessing
                ? "var(--upi-orange)"
                : isSuccess
                ? "var(--upi-green)"
                : isFailed
                ? "var(--crimson)"
                : "var(--upi-green)",
              boxShadow: isProcessing
                ? "0 0 8px var(--upi-orange)"
                : isSuccess
                ? "0 0 8px var(--upi-green)"
                : "0 0 8px var(--upi-green)",
            }}
            className="pulse-glow"
          />
          <span
            style={{
              fontSize: "0.82rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "var(--ink-secondary)",
              textTransform: "uppercase",
            }}
          >
            UPI Service Architecture Tree
          </span>

          {isProcessing && (
            <span
              style={{
                fontSize: "0.70rem",
                padding: "2px 8px",
                borderRadius: "var(--radius-pill)",
                background: "var(--upi-orange-tint)",
                color: "var(--upi-orange)",
                border: "1px solid var(--upi-orange-border)",
                fontWeight: 700,
              }}
            >
              Transaction Processing (Orange Flow)
            </span>
          )}
          {isSuccess && (
            <span
              style={{
                fontSize: "0.70rem",
                padding: "2px 8px",
                borderRadius: "var(--radius-pill)",
                background: "var(--upi-green-tint)",
                color: "var(--upi-green)",
                border: "1px solid var(--upi-green-border)",
                fontWeight: 700,
              }}
            >
              Settlement Confirmed (Green Response)
            </span>
          )}
          {isFailed && (
            <span
              style={{
                fontSize: "0.70rem",
                padding: "2px 8px",
                borderRadius: "var(--radius-pill)",
                background: "var(--crimson-tint)",
                color: "var(--crimson)",
                border: "1px solid var(--crimson-border)",
                fontWeight: 700,
              }}
            >
              Rollback Executed (Red Compensate)
            </span>
          )}
        </div>

        <div
          style={{
            fontSize: "0.74rem",
            color: "var(--ink-muted)",
            display: "flex",
            alignItems: "center",
            gap: "14px",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ color: "var(--upi-green)", fontWeight: 800 }}>&darr;</span> Request Flow
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ color: "var(--upi-orange)", fontWeight: 800 }}>&uarr;</span> Response Flow
          </span>
          <span style={{ fontStyle: "italic" }}>Click any node for details</span>
        </div>
      </div>

      {/* Main Tree Architecture Canvas (Compact, All 5 Nodes Visible Without Scrolling) */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "435px",
          zIndex: 2,
        }}
      >
        {/* SVG Connection Lines & Directional Arrows */}
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          <defs>
            {/* Crisp Arrowhead Markers */}
            <marker
              id="arrow-down-orange"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#FF6600" />
            </marker>

            <marker
              id="arrow-down-green"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#00875A" />
            </marker>

            <marker
              id="arrow-down-crimson"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#DC2626" />
            </marker>

            <marker
              id="arrow-up-green"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#00875A" />
            </marker>

            <marker
              id="arrow-up-orange"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#FF6600" />
            </marker>

            <marker
              id="arrow-up-idle"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#94A3B8" />
            </marker>

            <filter id="glowGreen" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="glowOrange" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* ============================================================== */}
          {/* 1. USER CLIENT -> TRANSACTION SERVICE                           */}
          {/* ============================================================== */}
          {/* Forward Downward Request Line: Bottom of Client (70) to Top of Coordinator (128) */}
          <line
            x1="52%"
            y1="70"
            x2="52%"
            y2="128"
            stroke={primaryLineColor}
            strokeWidth="2.2"
            className={primaryLineClass}
            strokeDasharray={isProcessing ? "5 3" : undefined}
            markerEnd={`url(#${primaryMarkerId})`}
            filter={
              isProcessing
                ? "url(#glowOrange)"
                : isSuccess
                ? "url(#glowGreen)"
                : undefined
            }
          />

          {/* Reverse Upward Response Line: Top of Coordinator (130) to Bottom of Client (72) */}
          <line
            x1="48%"
            y1="130"
            x2="48%"
            y2="72"
            stroke={responseLineColor}
            strokeWidth="1.8"
            strokeDasharray="4 3"
            className={responseLineClass}
            markerEnd={`url(#${responseMarkerId})`}
            filter={isSuccess ? "url(#glowGreen)" : undefined}
          />

          {/* ============================================================== */}
          {/* 2. TRANSACTION SERVICE -> NPCI SWITCH                           */}
          {/* ============================================================== */}
          {/* Forward Downward Request Line: Bottom of Coordinator (190) to Top of NPCI (246) */}
          <line
            x1="52%"
            y1="190"
            x2="52%"
            y2="246"
            stroke={primaryLineColor}
            strokeWidth="2.2"
            className={primaryLineClass}
            strokeDasharray={isProcessing ? "5 3" : undefined}
            markerEnd={`url(#${primaryMarkerId})`}
            filter={
              isProcessing
                ? "url(#glowOrange)"
                : isSuccess
                ? "url(#glowGreen)"
                : undefined
            }
          />

          {/* Reverse Upward Response Line: Top of NPCI (248) to Bottom of Coordinator (192) */}
          <line
            x1="48%"
            y1="248"
            x2="48%"
            y2="192"
            stroke={responseLineColor}
            strokeWidth="1.8"
            strokeDasharray="4 3"
            className={responseLineClass}
            markerEnd={`url(#${responseMarkerId})`}
            filter={isSuccess ? "url(#glowGreen)" : undefined}
          />

          {/* ============================================================== */}
          {/* 3. NPCI SWITCH -> SENDER BANK & RECEIVER BANK (Branching Tree) */}
          {/* ============================================================== */}
          {/* Forward Downward Stem from bottom of NPCI Switch (306) to crossbar (334) */}
          <line
            x1="52%"
            y1="306"
            x2="52%"
            y2="334"
            stroke={primaryLineColor}
            strokeWidth="2.2"
            className={primaryLineClass}
            strokeDasharray={isProcessing ? "5 3" : undefined}
          />

          {/* Horizontal Crossbar Left to Sender Bank Branch */}
          <line
            x1="52%"
            y1="334"
            x2="26%"
            y2="334"
            stroke={primaryLineColor}
            strokeWidth="2.2"
            className={primaryLineClass}
            strokeDasharray={isProcessing ? "5 3" : undefined}
          />

          {/* Left Branch Vertical Drop into Sender Bank (334 -> 362) */}
          <line
            x1="26%"
            y1="334"
            x2="26%"
            y2="362"
            stroke={primaryLineColor}
            strokeWidth="2.2"
            className={primaryLineClass}
            strokeDasharray={isProcessing ? "5 3" : undefined}
            markerEnd={`url(#${primaryMarkerId})`}
            filter={
              isProcessing
                ? "url(#glowOrange)"
                : isSuccess
                ? "url(#glowGreen)"
                : undefined
            }
          />

          {/* Horizontal Crossbar Right to Receiver Bank Branch */}
          <line
            x1="52%"
            y1="334"
            x2="74%"
            y2="334"
            stroke={primaryLineColor}
            strokeWidth="2.2"
            className={primaryLineClass}
            strokeDasharray={isProcessing ? "5 3" : undefined}
          />

          {/* Right Branch Vertical Drop into Receiver Bank (334 -> 362) */}
          <line
            x1="74%"
            y1="334"
            x2="74%"
            y2="362"
            stroke={primaryLineColor}
            strokeWidth="2.2"
            className={primaryLineClass}
            strokeDasharray={isProcessing ? "5 3" : undefined}
            markerEnd={`url(#${primaryMarkerId})`}
            filter={
              isProcessing
                ? "url(#glowOrange)"
                : isSuccess
                ? "url(#glowGreen)"
                : undefined
            }
          />

          {/* Reverse Response from Sender Bank back up to NPCI Switch */}
          {/* Vertical rise from Sender Bank */}
          <line
            x1="28%"
            y1="364"
            x2="28%"
            y2="344"
            stroke={responseLineColor}
            strokeWidth="1.8"
            strokeDasharray="4 3"
            className={responseLineClass}
          />
          {/* Horizontal return crossbar to center */}
          <line
            x1="28%"
            y1="344"
            x2="48%"
            y2="344"
            stroke={responseLineColor}
            strokeWidth="1.8"
            strokeDasharray="4 3"
            className={responseLineClass}
          />
          {/* Vertical rise into bottom of NPCI Switch */}
          <line
            x1="48%"
            y1="344"
            x2="48%"
            y2="308"
            stroke={responseLineColor}
            strokeWidth="1.8"
            strokeDasharray="4 3"
            className={responseLineClass}
            markerEnd={`url(#${responseMarkerId})`}
            filter={isSuccess ? "url(#glowGreen)" : undefined}
          />

          {/* Reverse Response from Receiver Bank back up to NPCI Switch */}
          {/* Vertical rise from Receiver Bank */}
          <line
            x1="72%"
            y1="364"
            x2="72%"
            y2="344"
            stroke={responseLineColor}
            strokeWidth="1.8"
            strokeDasharray="4 3"
            className={responseLineClass}
          />
          {/* Horizontal return crossbar to center */}
          <line
            x1="72%"
            y1="344"
            x2="48%"
            y2="344"
            stroke={responseLineColor}
            strokeWidth="1.8"
            strokeDasharray="4 3"
            className={responseLineClass}
          />
        </svg>

        {/* ============================================================== */}
        {/* PROTOCOL LABELS ALONGSIDE ARROWS (NOT BLOCKING ARROWS)         */}
        {/* ============================================================== */}
        {/* Connection 1 Forward Label: REST API */}
        <div
          style={{
            position: "absolute",
            top: "92px",
            left: "calc(52% + 14px)",
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            gap: "5px",
            background: "#FFFFFF",
            border: isProcessing
              ? "1px solid var(--upi-orange)"
              : isSuccess
              ? "1px solid var(--upi-green)"
              : "1px solid var(--upi-green-border)",
            padding: "2px 8px",
            borderRadius: "var(--radius-pill)",
            fontSize: "0.68rem",
            fontWeight: 700,
            color: isProcessing
              ? "var(--upi-orange)"
              : isSuccess
              ? "var(--upi-green)"
              : "var(--ink-secondary)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <span>&darr; REST API</span>
          <span style={{ fontSize: "0.62rem", color: "var(--ink-muted)" }}>
            POST /api/transaction/initiate
          </span>
        </div>

        {/* Connection 1 Reverse Label: 200 OK / WS Settlement */}
        <div
          style={{
            position: "absolute",
            top: "92px",
            right: "calc(52% + 14px)",
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            gap: "4px",
            background: "#FFFFFF",
            border: isSuccess
              ? "1px solid var(--upi-green)"
              : "1px solid var(--border-hairline)",
            padding: "2px 8px",
            borderRadius: "var(--radius-pill)",
            fontSize: "0.66rem",
            fontWeight: 600,
            color: isSuccess ? "var(--upi-green)" : "var(--ink-muted)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <span>&uarr; 200 OK / WS Settlement</span>
        </div>

        {/* Connection 2 Forward Label: Route Request */}
        <div
          style={{
            position: "absolute",
            top: "210px",
            left: "calc(52% + 14px)",
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            gap: "5px",
            background: "#FFFFFF",
            border: isProcessing
              ? "1px solid var(--upi-orange)"
              : isSuccess
              ? "1px solid var(--upi-green)"
              : "1px solid var(--upi-green-border)",
            padding: "2px 8px",
            borderRadius: "var(--radius-pill)",
            fontSize: "0.68rem",
            fontWeight: 700,
            color: isProcessing
              ? "var(--upi-orange)"
              : isSuccess
              ? "var(--upi-green)"
              : "var(--ink-secondary)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <span>&darr; Route Transaction</span>
          <span style={{ fontSize: "0.62rem", color: "var(--ink-muted)" }}>
            ISO 8583 / HTTP
          </span>
        </div>

        {/* Connection 2 Reverse Label: Settlement ACK */}
        <div
          style={{
            position: "absolute",
            top: "210px",
            right: "calc(52% + 14px)",
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            gap: "4px",
            background: "#FFFFFF",
            border: isSuccess
              ? "1px solid var(--upi-green)"
              : "1px solid var(--border-hairline)",
            padding: "2px 8px",
            borderRadius: "var(--radius-pill)",
            fontSize: "0.66rem",
            fontWeight: 600,
            color: isSuccess ? "var(--upi-green)" : "var(--ink-muted)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <span>&uarr; Settlement ACK</span>
        </div>

        {/* Connection 3 Left Label: 1. Validate & Debit */}
        <div
          style={{
            position: "absolute",
            top: "312px",
            left: "26%",
            transform: "translateX(-50%)",
            zIndex: 3,
            background: "#FFFFFF",
            border: isProcessing
              ? "1px solid var(--upi-orange)"
              : isSuccess
              ? "1px solid var(--upi-green)"
              : "1px solid var(--upi-green-border)",
            padding: "2px 8px",
            borderRadius: "var(--radius-pill)",
            fontSize: "0.66rem",
            fontWeight: 700,
            color: isProcessing
              ? "var(--upi-orange)"
              : isSuccess
              ? "var(--upi-green)"
              : "var(--ink-secondary)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          &darr; 1. Validate &amp; Debit
        </div>

        {/* Connection 3 Right Label: 2. Credit Account */}
        <div
          style={{
            position: "absolute",
            top: "312px",
            left: "74%",
            transform: "translateX(-50%)",
            zIndex: 3,
            background: "#FFFFFF",
            border: isProcessing
              ? "1px solid var(--upi-orange)"
              : isSuccess
              ? "1px solid var(--upi-green)"
              : "1px solid var(--upi-green-border)",
            padding: "2px 8px",
            borderRadius: "var(--radius-pill)",
            fontSize: "0.66rem",
            fontWeight: 700,
            color: isProcessing
              ? "var(--upi-orange)"
              : isSuccess
              ? "var(--upi-green)"
              : "var(--ink-secondary)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          &darr; 2. Credit Account
        </div>

        {/* Connection 3 Reverse Debit ACK Label */}
        <div
          style={{
            position: "absolute",
            top: "348px",
            left: "35%",
            zIndex: 3,
            background: "#FFFFFF",
            border: isSuccess
              ? "1px solid var(--upi-green)"
              : "1px solid var(--border-hairline)",
            padding: "1px 6px",
            borderRadius: "var(--radius-pill)",
            fontSize: "0.62rem",
            fontWeight: 600,
            color: isSuccess ? "var(--upi-green)" : "var(--ink-muted)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          &uarr; Debit ACK
        </div>

        {/* Connection 3 Reverse Credit ACK Label */}
        <div
          style={{
            position: "absolute",
            top: "348px",
            left: "64%",
            zIndex: 3,
            background: "#FFFFFF",
            border: isSuccess
              ? "1px solid var(--upi-green)"
              : "1px solid var(--border-hairline)",
            padding: "1px 6px",
            borderRadius: "var(--radius-pill)",
            fontSize: "0.62rem",
            fontWeight: 600,
            color: isSuccess ? "var(--upi-green)" : "var(--ink-muted)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          &uarr; Credit ACK
        </div>

        {/* ============================================================== */}
        {/* NODE 1: USER CLIENT (Top Center, 12px to 70px)                  */}
        {/* ============================================================== */}
        {(() => {
          const svc = services[0];
          const health = getServiceHealth(svc);
          const isSelected = selectedService?.id === svc.id;
          const Icon = svc.icon;

          return (
            <div
              onClick={() => handleCardClick(svc)}
              style={{
                position: "absolute",
                top: "12px",
                left: "50%",
                transform: "translateX(-50%)",
                width: "270px",
                height: "58px",
                boxSizing: "border-box",
                padding: "8px 14px",
                background: isSelected ? "var(--upi-orange-tint)" : "#FFFFFF",
                border: isSelected
                  ? "2px solid var(--upi-orange)"
                  : "1.5px solid var(--upi-green-border)",
                borderLeft: "4px solid var(--upi-orange)",
                borderRadius: "var(--radius-md)",
                boxShadow: isSelected
                  ? "0 6px 18px rgba(255, 102, 0, 0.16)"
                  : "0 2px 8px rgba(0, 0, 0, 0.05)",
                cursor: "pointer",
                transition: "all 0.18s ease",
                zIndex: 4,
                display: "flex",
                alignItems: "center",
              }}
              title="Click to view User Client details and health"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--upi-orange-tint)",
                      color: "var(--upi-orange)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={16} />
                  </div>
                  <div>
                    <h3
                      style={{
                        fontSize: "0.88rem",
                        fontWeight: 700,
                        color: "var(--ink-primary)",
                        margin: 0,
                        letterSpacing: "0.02em",
                        lineHeight: 1.2,
                      }}
                    >
                      {svc.name}
                    </h3>
                    <div style={{ fontSize: "0.68rem", color: "var(--ink-muted)", marginTop: "2px" }}>
                      Port {svc.port}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "var(--upi-green-tint)",
                    padding: "2px 7px",
                    borderRadius: "var(--radius-pill)",
                    border: "1px solid var(--upi-green-border)",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "var(--upi-green)",
                    }}
                    className="pulse-glow"
                  />
                  <span
                    style={{
                      fontSize: "0.64rem",
                      fontWeight: 700,
                      color: "var(--upi-green)",
                    }}
                  >
                    {health.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ============================================================== */}
        {/* NODE 2: TRANSACTION SERVICE (Center, 130px to 190px)            */}
        {/* ============================================================== */}
        {(() => {
          const svc = services[1];
          const health = getServiceHealth(svc);
          const isSelected = selectedService?.id === svc.id;
          const Icon = svc.icon;

          return (
            <div
              onClick={() => handleCardClick(svc)}
              style={{
                position: "absolute",
                top: "130px",
                left: "50%",
                transform: "translateX(-50%)",
                width: "300px",
                height: "60px",
                boxSizing: "border-box",
                padding: "8px 14px",
                background: isSelected ? "var(--upi-green-tint)" : "#FFFFFF",
                border: isSelected
                  ? "2px solid var(--upi-green)"
                  : isProcessing
                  ? "2px solid var(--upi-orange)"
                  : isSuccess
                  ? "2px solid var(--upi-green)"
                  : "1.5px solid var(--upi-green-border)",
                borderLeft: "4px solid var(--upi-green)",
                borderRadius: "var(--radius-md)",
                boxShadow: isSelected
                  ? "0 8px 22px rgba(0, 135, 90, 0.16)"
                  : "0 2px 8px rgba(0, 0, 0, 0.05)",
                cursor: "pointer",
                transition: "all 0.18s ease",
                zIndex: 4,
                display: "flex",
                alignItems: "center",
              }}
              title="Click to view Transaction Service coordinator details and health"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div
                    style={{
                      width: "30px",
                      height: "30px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--upi-green-tint)",
                      color: "var(--upi-green)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={16} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <h3
                        style={{
                          fontSize: "0.88rem",
                          fontWeight: 700,
                          color: "var(--ink-primary)",
                          margin: 0,
                          letterSpacing: "0.02em",
                          lineHeight: 1.2,
                        }}
                      >
                        {svc.name}
                      </h3>
                      <span
                        style={{
                          fontSize: "0.60rem",
                          padding: "1px 5px",
                          borderRadius: "var(--radius-pill)",
                          background: "var(--upi-green-tint)",
                          color: "var(--upi-green)",
                          fontWeight: 700,
                          border: "1px solid var(--upi-green-border)",
                        }}
                      >
                        Coordinator
                      </span>
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "var(--ink-muted)", marginTop: "2px" }}>
                      Port {svc.port}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "var(--upi-green-tint)",
                    padding: "2px 7px",
                    borderRadius: "var(--radius-pill)",
                    border: "1px solid var(--upi-green-border)",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "var(--upi-green)",
                    }}
                    className="pulse-glow"
                  />
                  <span
                    style={{
                      fontSize: "0.64rem",
                      fontWeight: 700,
                      color: "var(--upi-green)",
                    }}
                  >
                    {health.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ============================================================== */}
        {/* NODE 3: NPCI SWITCH (Center, 248px to 306px)                    */}
        {/* ============================================================== */}
        {(() => {
          const svc = services[2];
          const health = getServiceHealth(svc);
          const isSelected = selectedService?.id === svc.id;
          const Icon = svc.icon;

          return (
            <div
              onClick={() => handleCardClick(svc)}
              style={{
                position: "absolute",
                top: "248px",
                left: "50%",
                transform: "translateX(-50%)",
                width: "270px",
                height: "58px",
                boxSizing: "border-box",
                padding: "8px 14px",
                background: isSelected ? "var(--upi-green-tint)" : "#FFFFFF",
                border: isSelected
                  ? "2px solid var(--upi-green)"
                  : "1.5px solid var(--upi-green-border)",
                borderLeft: "4px solid var(--upi-orange)",
                borderRadius: "var(--radius-md)",
                boxShadow: isSelected
                  ? "0 6px 18px rgba(0, 135, 90, 0.16)"
                  : "0 2px 8px rgba(0, 0, 0, 0.05)",
                cursor: "pointer",
                transition: "all 0.18s ease",
                zIndex: 4,
                display: "flex",
                alignItems: "center",
              }}
              title="Click to view NPCI Switch router details and health"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--upi-green-tint)",
                      color: "var(--upi-green)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={16} />
                  </div>
                  <div>
                    <h3
                      style={{
                        fontSize: "0.88rem",
                        fontWeight: 700,
                        color: "var(--ink-primary)",
                        margin: 0,
                        letterSpacing: "0.02em",
                        lineHeight: 1.2,
                      }}
                    >
                      {svc.name}
                    </h3>
                    <div style={{ fontSize: "0.68rem", color: "var(--ink-muted)", marginTop: "2px" }}>
                      Port {svc.port}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "var(--upi-green-tint)",
                    padding: "2px 7px",
                    borderRadius: "var(--radius-pill)",
                    border: "1px solid var(--upi-green-border)",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "var(--upi-green)",
                    }}
                    className="pulse-glow"
                  />
                  <span
                    style={{
                      fontSize: "0.64rem",
                      fontWeight: 700,
                      color: "var(--upi-green)",
                    }}
                  >
                    {health.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ============================================================== */}
        {/* NODE 4: SENDER BANK (Bottom Left, 364px to 422px)               */}
        {/* ============================================================== */}
        {(() => {
          const svc = services[3];
          const health = getServiceHealth(svc);
          const isSelected = selectedService?.id === svc.id;
          const Icon = svc.icon;

          return (
            <div
              onClick={() => handleCardClick(svc)}
              style={{
                position: "absolute",
                top: "364px",
                left: "26%",
                transform: "translateX(-50%)",
                width: "250px",
                height: "58px",
                boxSizing: "border-box",
                padding: "8px 14px",
                background: isSelected ? "var(--upi-orange-tint)" : "#FFFFFF",
                border: isSelected
                  ? "2px solid var(--upi-orange)"
                  : "1.5px solid var(--upi-green-border)",
                borderLeft: "4px solid var(--upi-orange)",
                borderRadius: "var(--radius-md)",
                boxShadow: isSelected
                  ? "0 6px 18px rgba(255, 102, 0, 0.16)"
                  : "0 2px 8px rgba(0, 0, 0, 0.05)",
                cursor: "pointer",
                transition: "all 0.18s ease",
                zIndex: 4,
                display: "flex",
                alignItems: "center",
              }}
              title="Click to view Sender Bank (Remitter CBS) details and health"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--upi-orange-tint)",
                      color: "var(--upi-orange)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={16} />
                  </div>
                  <div>
                    <h4
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 700,
                        color: "var(--ink-primary)",
                        margin: 0,
                        letterSpacing: "0.02em",
                        lineHeight: 1.2,
                      }}
                    >
                      {svc.name}
                    </h4>
                    <div style={{ fontSize: "0.68rem", color: "var(--ink-muted)", marginTop: "2px" }}>
                      Port {svc.port}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "var(--upi-green-tint)",
                    padding: "2px 7px",
                    borderRadius: "var(--radius-pill)",
                    border: "1px solid var(--upi-green-border)",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "var(--upi-green)",
                    }}
                    className="pulse-glow"
                  />
                  <span
                    style={{
                      fontSize: "0.64rem",
                      fontWeight: 700,
                      color: "var(--upi-green)",
                    }}
                  >
                    {health.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ============================================================== */}
        {/* NODE 5: RECEIVER BANK (Bottom Right, 364px to 422px)            */}
        {/* ============================================================== */}
        {(() => {
          const svc = services[4];
          const health = getServiceHealth(svc);
          const isSelected = selectedService?.id === svc.id;
          const Icon = svc.icon;

          return (
            <div
              onClick={() => handleCardClick(svc)}
              style={{
                position: "absolute",
                top: "364px",
                left: "74%",
                transform: "translateX(-50%)",
                width: "250px",
                height: "58px",
                boxSizing: "border-box",
                padding: "8px 14px",
                background: isSelected ? "var(--upi-orange-tint)" : "#FFFFFF",
                border: isSelected
                  ? "2px solid var(--upi-orange)"
                  : "1.5px solid var(--upi-green-border)",
                borderLeft: "4px solid var(--upi-orange)",
                borderRadius: "var(--radius-md)",
                boxShadow: isSelected
                  ? "0 6px 18px rgba(255, 102, 0, 0.16)"
                  : "0 2px 8px rgba(0, 0, 0, 0.05)",
                cursor: "pointer",
                transition: "all 0.18s ease",
                zIndex: 4,
                display: "flex",
                alignItems: "center",
              }}
              title="Click to view Receiver Bank (Beneficiary CBS) details and health"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--upi-orange-tint)",
                      color: "var(--upi-orange)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={16} />
                  </div>
                  <div>
                    <h4
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 700,
                        color: "var(--ink-primary)",
                        margin: 0,
                        letterSpacing: "0.02em",
                        lineHeight: 1.2,
                      }}
                    >
                      {svc.name}
                    </h4>
                    <div style={{ fontSize: "0.68rem", color: "var(--ink-muted)", marginTop: "2px" }}>
                      Port {svc.port}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "var(--upi-green-tint)",
                    padding: "2px 7px",
                    borderRadius: "var(--radius-pill)",
                    border: "1px solid var(--upi-green-border)",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "var(--upi-green)",
                    }}
                    className="pulse-glow"
                  />
                  <span
                    style={{
                      fontSize: "0.64rem",
                      fontWeight: 700,
                      color: "var(--upi-green)",
                    }}
                  >
                    {health.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ============================================================== */}
      {/* FLOATING INTERACTIVE DETAILS PANEL (Opened on Node Click)       */}
      {/* ============================================================== */}
      {selectedService && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.45)",
            backdropFilter: "blur(3px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
          onClick={() => setSelectedService(null)}
        >
          <div
            style={{
              background: "#FFFFFF",
              border: "1.5px solid var(--upi-green-border)",
              borderTop: "5px solid var(--upi-green)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "0 20px 45px rgba(0, 0, 0, 0.16)",
              maxWidth: "500px",
              width: "100%",
              padding: "22px 24px",
              position: "relative",
            }}
            className="toast-enter"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                borderBottom: "1px solid var(--border-hairline)",
                paddingBottom: "12px",
                marginBottom: "16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "var(--radius-md)",
                    background:
                      selectedService.id === "coordinator" ||
                      selectedService.id === "npci"
                        ? "var(--upi-green-tint)"
                        : "var(--upi-orange-tint)",
                    color:
                      selectedService.id === "coordinator" ||
                      selectedService.id === "npci"
                        ? "var(--upi-green)"
                        : "var(--upi-orange)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <selectedService.icon size={20} />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <h2
                      style={{
                        fontSize: "1.1rem",
                        fontWeight: 800,
                        color: "var(--ink-primary)",
                        margin: 0,
                      }}
                    >
                      {selectedService.name}
                    </h2>
                    <span
                      style={{
                        fontSize: "0.68rem",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-pill)",
                        background: "var(--upi-green-tint)",
                        color: "var(--upi-green)",
                        fontWeight: 700,
                        border: "1px solid var(--upi-green-border)",
                      }}
                    >
                      {selectedService.badge}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--ink-muted)" }}>
                    {selectedService.subtitle}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedService(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--ink-muted)",
                  padding: "4px",
                  borderRadius: "var(--radius-sm)",
                }}
                title="Close panel"
              >
                <X size={18} />
              </button>
            </div>

            {/* Architecture Details Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  background: "var(--bg-app)",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-hairline)",
                }}
              >
                <div
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    color: "var(--ink-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: "3px",
                  }}
                >
                  Network Port &amp; Protocol
                </div>
                <div
                  style={{
                    fontSize: "0.80rem",
                    fontWeight: 700,
                    color: "var(--ink-primary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {selectedService.port}
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--ink-secondary)" }}>
                  {selectedService.protocol}
                </div>
              </div>

              <div
                style={{
                  background: "var(--bg-app)",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-hairline)",
                }}
              >
                <div
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    color: "var(--ink-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: "3px",
                  }}
                >
                  Database / Storage Shard
                </div>
                <div
                  style={{
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    color: "var(--ink-primary)",
                  }}
                >
                  {selectedService.database}
                </div>
              </div>
            </div>

            {/* Architectural Role */}
            <div style={{ marginBottom: "16px" }}>
              <div
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  color: "var(--ink-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: "4px",
                }}
              >
                Distributed System Responsibility
              </div>
              <p
                style={{
                  fontSize: "0.82rem",
                  color: "var(--ink-secondary)",
                  lineHeight: 1.5,
                  margin: 0,
                  background: "rgba(255, 102, 0, 0.03)",
                  borderLeft: "3px solid var(--upi-orange)",
                  padding: "8px 12px",
                  borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
                }}
              >
                {selectedService.role}
              </p>
            </div>

            {/* Live Health Status & Ping Probe Button */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                background: "var(--bg-app)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-hairline)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "var(--upi-green)",
                  }}
                  className="pulse-glow"
                />
                <div>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      color: "var(--upi-green)",
                    }}
                  >
                    STATUS: HEALTHY
                  </div>
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--ink-muted)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    Endpoint: {selectedService.healthUrl}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleProbe(selectedService)}
                disabled={probing}
                style={{
                  fontSize: "0.76rem",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--upi-green)",
                  color: "#FFFFFF",
                  border: "none",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
                title="Send real live HTTP probe to microservice"
              >
                <Activity size={13} className={probing ? "spin" : ""} />
                <span>{probing ? "Probing..." : "Ping Probe"}</span>
              </button>
            </div>

            {/* Probe Results */}
            {probeResult && (
              <div
                style={{
                  marginTop: "12px",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  background: probeResult.success
                    ? "var(--upi-green-tint)"
                    : "var(--crimson-tint)",
                  border: `1px solid ${
                    probeResult.success
                      ? "var(--upi-green-border)"
                      : "var(--crimson-border)"
                  }`,
                  fontSize: "0.75rem",
                  color: probeResult.success
                    ? "var(--upi-green)"
                    : "var(--crimson)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <strong>
                    {probeResult.success ? "HTTP 200 OK" : "Probe Failed"}:
                  </strong>{" "}
                  Live heartbeat verified
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                  }}
                >
                  {probeResult.latencyMs} ms latency
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
