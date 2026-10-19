import { useState } from "react";
import PageShell from "../components/layout/PageShell";
import {
  Layers,
  Box,
  Server,
  Cpu,
  Shield,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Terminal,
  Lock,
  Globe,
  Database,
  ArrowRight,
  RefreshCw,
  HardDrive,
  FileCode,
} from "lucide-react";

export default function Unit4View() {
  const [activeTab, setActiveTab] = useState("docker");
  const [activeManifest, setActiveManifest] = useState("dockerfile");

  const manifests = {
    dockerfile: {
      filename: "Dockerfile",
      apiVersion: "Multi-Stage OCI",
      kind: "Dockerfile",
      desc: "Hardened multi-stage build creating an unprivileged non-root Alpine container with dumb-init and native healthcheck.",
      code: `# Stage 1: Build Frontend Assets
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Hardened Production Runtime
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 SQLITE_DB_PATH=/app/data/upi_simulator.db TMPDIR=/tmp
RUN apk add --no-cache curl dumb-init
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/protos ./protos
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /app/data /tmp/.cache /tmp/.npm && chown -R node:node /app /tmp
VOLUME ["/app/data"]
USER node
EXPOSE 3000 50051

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "--experimental-sqlite", "--import", "tsx", "server.ts"]`,
    },
    compose: {
      filename: "compose.yaml",
      apiVersion: "Docker Compose v2",
      kind: "Compose Spec",
      desc: "Production Docker Compose definition mapping ports 3000 & 50051 with persistent SQLite storage volume.",
      code: `name: upi-distributed-simulator

services:
  upi-simulator:
    build:
      context: .
      dockerfile: Dockerfile
    image: upi-simulator:latest
    container_name: upi-simulator-app
    restart: unless-stopped
    ports:
      - "3000:3000"    # HTTP, REST API, WebSocket & WebRTC
      - "50051:50051"  # gRPC HTTP/2 Protocol Buffer Account Service
    environment:
      - NODE_ENV=production
      - PORT=3000
      - SQLITE_DB_PATH=/app/data/upi_simulator.db
      - CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
      - CIRCUIT_BREAKER_RECOVERY_TIMEOUT=10
      - CIRCUIT_BREAKER_SUCCESS_THRESHOLD=1
      - MAX_RETRIES=2
      - RETRY_DELAY_SECONDS=0.4
      - REQUEST_TIMEOUT_SECONDS=3
    volumes:
      - upi_data:/app/data
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:3000/health"]
      interval: 15s
      timeout: 3s
      retries: 3
      start_period: 10s
    security_opt:
      - no-new-privileges:true

volumes:
  upi_data:
    name: upi_simulator_data`,
    },
    deployment: {
      filename: "k8s/deployment.yaml",
      apiVersion: "apps/v1",
      kind: "Deployment",
      desc: "Single-replica Recreate deployment: SQLite on a ReadWriteOnce PVC cannot safely surge a second writer pod.",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: upi-simulator
  labels:
    app: upi-simulator
    component: core-orchestrator
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: upi-simulator
  template:
    metadata:
      labels:
        app: upi-simulator
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: upi-core
          image: upi-simulator:latest
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          ports:
            - containerPort: 3000
              name: http
            - containerPort: 50051
              name: grpc
          startupProbe:
            httpGet:
              path: /health
              port: 3000
            failureThreshold: 30
            periodSeconds: 2
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 2
            periodSeconds: 5`,
    },
    service: {
      filename: "k8s/service.yaml",
      apiVersion: "v1",
      kind: "Service",
      desc: "ClusterIP Service for HTTP :3000 and gRPC :50051. Use kubectl port-forward in local clusters.",
      code: `apiVersion: v1
kind: Service
metadata:
  name: upi-simulator-service
spec:
  type: ClusterIP
  selector:
    app: upi-simulator
  ports:
    - name: http
      port: 3000
      targetPort: 3000
    - name: grpc
      port: 50051
      targetPort: 50051`,
    },
    statefulset: {
      filename: "k8s/statefulset.yaml",
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      desc: "StatefulSet deploying consensus nodes with stable network identities and per-pod dedicated volumeClaimTemplates.",
      code: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: upi-consensus-nodes
spec:
  serviceName: upi-headless-service
  replicas: 3
  selector:
    matchLabels:
      app: upi-consensus
  template:
    metadata:
      labels:
        app: upi-consensus
    spec:
      containers:
        - name: consensus-member
          image: upi-simulator:latest
          ports:
            - containerPort: 3000
              name: http
          volumeMounts:
            - name: dedicated-node-storage
              mountPath: /app/data
  volumeClaimTemplates:
    - metadata:
        name: dedicated-node-storage
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 500Mi`,
    },
  };

  const currentItem = manifests[activeManifest] || manifests.dockerfile;

  return (
    <PageShell>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="unit-tag">Part 4 &bull; Unit IV Deployment Architecture</div>
          <h1 className="page-title">Containerization, Orchestration &amp; Database Architecture</h1>
          <p className="page-subtitle">
            Docker multi-stage containerization, Compose persistence, Kubernetes Deployments, triple health probes, and multi-replica database isolation.
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
          <button
            type="button"
            className={`seg-pill ${activeTab === "db-arch" ? "active" : ""}`}
            onClick={() => setActiveTab("db-arch")}
          >
            3. Database Architecture &amp; Replicas
          </button>
          <button
            type="button"
            className={`seg-pill ${activeTab === "manifests" ? "active" : ""}`}
            onClick={() => setActiveTab("manifests")}
          >
            4. Declarative Manifests
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

      {/* TAB 3: DATABASE ARCHITECTURE & REPLICAS */}
      {activeTab === "db-arch" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <Database size={18} style={{ color: "var(--upi-orange)" }} />
                <span>Multi-Replica Database Architecture &amp; SQLite Concurrency Rules</span>
              </div>
              <span className="status-pill warning">Strict Concurrency Policy</span>
            </div>

            <div style={{ padding: "14px", background: "var(--crimson-tint)", border: "1px solid var(--crimson-border)", borderRadius: "var(--radius-sm)", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <AlertTriangle size={16} style={{ color: "var(--crimson)" }} />
                <strong style={{ fontSize: "0.88rem", color: "var(--crimson)" }}>
                  Architectural Rule: Never Share a Single SQLite File Across Multiple Concurrent Replicas
                </strong>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", margin: 0, lineHeight: 1.5 }}>
                SQLite uses local OS advisory locks (<code>fcntl</code> / <code>flock</code>). When multiple application replicas mount the same SQLite database file over a network filesystem (such as NFS, SMB, or multi-attach ReadWriteMany PVCs), file locks are notoriously unreliable across separate kernel instances, leading to corrupted WAL headers and torn writes.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              {/* Pattern 1 */}
              <div style={{ padding: "16px", borderRadius: "var(--radius-sm)", background: "#FFFFFF", border: "1px solid var(--border-hairline)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <strong style={{ fontSize: "0.9rem", color: "var(--upi-green)" }}>Option A: StatefulSet with Dedicated Per-Pod PVCs</strong>
                  <span className="status-pill success">Used in StatefulSet</span>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", lineHeight: 1.55 }}>
                  Each consensus replica runs with its own dedicated <code>volumeClaimTemplates</code> (ReadWriteOnce). Replicas do not share database files directly; instead, state is replicated over the network using Raft consensus or distributed log streaming via the Headless Service.
                </p>
                <div style={{ fontSize: "0.74rem", color: "var(--ink-muted)", marginTop: "8px" }}>
                  <strong>Advantages:</strong> Clean crash isolation, zero file-lock contention, deterministic per-node rollback.
                </div>
              </div>

              {/* Pattern 2 */}
              <div style={{ padding: "16px", borderRadius: "var(--radius-sm)", background: "#FFFFFF", border: "1px solid var(--border-hairline)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <strong style={{ fontSize: "0.9rem", color: "var(--blue-accent)" }}>Option B: Centralized Client-Server Relational DB</strong>
                  <span className="status-pill neutral">Cloud Scale</span>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", lineHeight: 1.55 }}>
                  Stateless application pods connect over TCP to a dedicated relational database service (such as PostgreSQL, Cloud SQL, or CockroachDB). Concurrency control, MVCC, and row-level locking are managed authoritatively by the database server.
                </p>
                <div style={{ fontSize: "0.74rem", color: "var(--ink-muted)", marginTop: "8px" }}>
                  <strong>Advantages:</strong> Arbitrary stateless scaling (2 to 10+ pods via HPA) with centralized ACID transaction guarantees.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: DECLARATIVE MANIFESTS */}
      {activeTab === "manifests" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div className="card-clean">
            <div className="card-header-bar">
              <div className="card-title">
                <FileCode size={18} style={{ color: "var(--upi-orange)" }} />
                <span>Declarative Manifest Repository</span>
              </div>
              <span className="status-pill neutral">{currentItem.kind}</span>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", lineHeight: 1.55, marginBottom: "14px" }}>
              Inspect the exact production configurations used to package, run, and orchestrate the UPI distributed simulator:
            </p>

            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
              {Object.keys(manifests).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="btn-secondary"
                  style={{
                    padding: "6px 12px",
                    fontSize: "0.78rem",
                    borderColor: activeManifest === k ? "var(--upi-orange)" : "var(--border-hairline)",
                    background: activeManifest === k ? "var(--upi-orange-tint)" : "#FFFFFF",
                  }}
                  onClick={() => setActiveManifest(k)}
                >
                  {manifests[k].kind}
                </button>
              ))}
            </div>

            <div style={{ borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border-hairline)" }}>
              <div style={{ padding: "8px 14px", background: "#0F172A", color: "#E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "#38BDF8" }}>
                  {currentItem.filename}
                </span>
                <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>{currentItem.desc}</span>
              </div>
              <pre style={{ margin: 0, padding: "14px", background: "#0F172A", color: "#E2E8F0", fontSize: "0.76rem", overflowX: "auto", fontFamily: "var(--font-mono)", lineHeight: 1.5, borderTop: "1px solid #1E293B" }}>
                {currentItem.code}
              </pre>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
