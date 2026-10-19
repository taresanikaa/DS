import { useState } from "react";
import PageShell from "../components/layout/PageShell";
import {
  Box,
  Server,
  Shield,
  Activity,
  Lock,
} from "lucide-react";

export default function Unit4View() {
  const [activeTab, setActiveTab] = useState("docker");

  return (
    <PageShell>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="unit-tag">Part 4 &bull; Unit IV Deployment Architecture</div>
          <h1 className="page-title">Containerization &amp; Kubernetes Orchestration</h1>
          <p className="page-subtitle">
            Docker multi-stage containerization, Compose persistence, Kubernetes Deployments, and triple health probes.
          </p>
        </div>

        {/* Sub-tab Navigation */}
        <div className="segmented-pills">
          <button
            type="button"
            className={`seg-pill ${activeTab === "docker" ? "active" : ""}`}
            onClick={() => setActiveTab("docker")}
          >
            1. Docker Containerization
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "k8s" ? "active" : ""}`}
            onClick={() => setActiveTab("k8s")}
          >
            2. Kubernetes Orchestration
          </button>
        </div>
      </div>

      {/* TAB 1: DOCKER CONTAINERIZATION */}
      {activeTab === "docker" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Box size={18} style={{ color: "var(--upi-orange)" }} />
                <span>Production Multi-Stage Docker Build Architecture</span>
              </div>
              <span className="status-pill success">Node.js 22 Alpine Hardened</span>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", lineHeight: 1.55, marginBottom: "16px" }}>
              The application utilizes a secure two-stage Docker build to keep image sizes minimal, eliminate developer dependencies from production images, and ensure reproducible builds across development and production environments.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px", marginBottom: "18px" }}>
              <div style={{ padding: "14px", background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)" }}>
                <strong style={{ fontSize: "0.85rem", color: "var(--upi-orange)" }}>Stage 1: Asset Builder</strong>
                <p style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", marginTop: "4px", lineHeight: 1.5 }}>
                  Installs all dependencies via <code>npm ci</code>, compiles TypeScript, and generates optimized production Vite bundles in <code>/app/dist</code>. Discarded upon completion.
                </p>
              </div>

              <div style={{ padding: "14px", background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)" }}>
                <strong style={{ fontSize: "0.85rem", color: "var(--upi-green)" }}>Stage 2: Hardened Runtime</strong>
                <p style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", marginTop: "4px", lineHeight: 1.5 }}>
                  Only production dependencies (<code>npm ci --omit=dev</code>). Runs as unprivileged non-root user <code>node</code> (UID 1000) with <code>dumb-init</code> for PID 1 signal forwarding.
                </p>
              </div>

              <div style={{ padding: "14px", background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)" }}>
                <strong style={{ fontSize: "0.85rem", color: "var(--blue-accent)" }}>Named Persistent Volume</strong>
                <p style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", marginTop: "4px", lineHeight: 1.5 }}>
                  Mounts named volume <code>upi_data:/app/data</code>. Preserves all accounts, transactions, and WAL ledger logs across container restarts or image upgrades.
                </p>
              </div>
            </div>

            {/* Docker CLI commands summary */}
            <div style={{ padding: "14px", borderRadius: "var(--radius-sm)", background: "#0F172A", color: "#E2E8F0", border: "1px solid #1E293B" }}>
              <div style={{ fontSize: "0.76rem", fontWeight: 700, color: "#38BDF8", textTransform: "uppercase", marginBottom: "8px" }}>
                Production Docker Commands:
              </div>
              <pre style={{ margin: 0, fontSize: "0.76rem", fontFamily: "var(--font-mono)", lineHeight: 1.6, color: "#94A3B8" }}>
{`# 1. Build and start container using Docker Compose:
docker compose up -d --build

# 2. Inspect running container status and native healthcheck:
docker compose ps
curl http://localhost:3000/health

# 3. View live container logs:
docker compose logs -f upi-simulator

# 4. Stop container without deleting persistent database volume:
docker compose down`}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: KUBERNETES ORCHESTRATION */}
      {activeTab === "k8s" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Server size={18} style={{ color: "var(--upi-green)" }} />
                <span>Kubernetes v1.26+ Pod Security &amp; Probes</span>
              </div>
              <span className="status-pill success">apps/v1 Standard</span>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", lineHeight: 1.55, marginBottom: "16px" }}>
              The deployment specification enforces production Kubernetes zero-downtime rolling updates (<code>maxSurge: 1, maxUnavailable: 0</code>) and drops all Linux kernel capabilities for container sandboxing.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px", marginBottom: "16px" }}>
              <div style={{ padding: "14px", background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <Shield size={15} style={{ color: "var(--upi-green)" }} />
                  <strong style={{ fontSize: "0.85rem" }}>Rootless Execution</strong>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>
                  Enforces <code>runAsNonRoot: true</code> with unprivileged UID/GID 1000.
                </div>
              </div>

              <div style={{ padding: "14px", background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <Lock size={15} style={{ color: "var(--upi-orange)" }} />
                  <strong style={{ fontSize: "0.85rem" }}>Read-Only Root Filesystem</strong>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>
                  Prevents tampered binary modification; write access limited to <code>/tmp</code> and <code>/app/data</code>.
                </div>
              </div>

              <div style={{ padding: "14px", background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-hairline)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <Activity size={15} style={{ color: "var(--blue-accent)" }} />
                  <strong style={{ fontSize: "0.85rem" }}>Triple Health Probes</strong>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)" }}>
                  Configured with Startup, Liveness, and Readiness probes polling HTTP GET <code>/health</code> on port 3000.
                </div>
              </div>
            </div>

            {/* Health Probes Table */}
            <div className="table-container">
              <table className="fintech-table">
                <thead>
                  <tr>
                    <th>Probe Type</th>
                    <th>Target</th>
                    <th>Failure Threshold</th>
                    <th>Period</th>
                    <th>Orchestrator Behavior</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Startup Probe</strong></td>
                    <td><code>GET /health:3000</code></td>
                    <td>30 attempts</td>
                    <td>2s</td>
                    <td>Prevents premature liveness termination during SQLite WAL boot</td>
                  </tr>
                  <tr>
                    <td><strong>Liveness Probe</strong></td>
                    <td><code>GET /health:3000</code></td>
                    <td>3 attempts</td>
                    <td>10s</td>
                    <td>Automatically restarts unresponsive container processes</td>
                  </tr>
                  <tr>
                    <td><strong>Readiness Probe</strong></td>
                    <td><code>GET /health:3000</code></td>
                    <td>3 attempts</td>
                    <td>5s</td>
                    <td>Removes unhealthy pod from Service endpoints to avoid routing traffic</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </PageShell>
  );
}
