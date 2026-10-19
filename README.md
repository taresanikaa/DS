# UPI Distributed Transaction Flow Simulator

An educational, interactive fullstack distributed systems simulator demonstrating UPI-inspired payment orchestration, ACID-compliant ledger transactions, Saga compensating rollbacks, multi-protocol communication (REST, gRPC/HTTP2, WebSockets, simulated AMQP, P2P, WebRTC), and classical distributed algorithms (Lamport & Vector Clocks, Berkeley Clock Synchronization, Ricart-Agrawala & Lodha-Kshemkalyani Mutual Exclusion, Bully & Ring Leader Elections, Chandy-Lamport Snapshots, and Knapp's Deadlock Detection).

> **Academic Simulator Notice**: This project is strictly an educational simulator demonstrating distributed-systems paradigms. It does not interface with actual production banking systems or live NPCI payment rails.

---

## Architecture Overview

```text
                                 [ Browser Web Client ]
                                           │
                        ┌──────────────────┴──────────────────┐
                        │ HTTP / REST            WebSocket    │
                        │ (:3000)                (/ws/*)      │
                        ▼                                     ▼
           ┌────────────────────────────────────────────────────────┐
           │        Transaction Coordinator & API Gateway           │
           │        Express.js + Vite 6 Middleware (Port 3000)      │
           └──────┬───────────────────────┬───────────────────┬─────┘
                  │                       │                   │
                  ▼                       ▼                   ▼
        ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
        │ Sender Bank      │    │ NPCI Switch      │    │ Receiver Bank    │
        │ Simulated Service│    │ Clearing Hub     │    │ Beneficiary Node │
        └─────────┬────────┘    └────────┬─────────┘    └────────┬─────────┘
                  │                      │                       │
                  └──────────────────────┼───────────────────────┘
                                         ▼
                 ┌────────────────────────────────────────────────┐
                 │       Authoritative Persistence Layer          │
                 │    SQLite (node:sqlite WAL mode, integer paise)│
                 │   Double-Entry Ledger + Idempotency Registry   │
                 └────────────────────────────────────────────────┘
```

### Components

1. **Client Tier**: React 18 SPA built with Vite 6, Tailwind CSS, and Lucide icons. Visualizes real-time transaction timelines, distributed clock counters, circuit breaker state machines, and interactive algorithm experiments.
2. **Gateway & Orchestrator Tier**: Unified Express.js server multiplexing REST APIs (`/api/*`), WebSocket event streaming (`/ws/transactions`), and WebRTC signaling (`/ws/webrtc`).
3. **gRPC Microservice Tier**: Binary RPC account service operating over HTTP/2 Protobuf on port `50051` (supporting `DebitAccount`, `CreditAccount`, `GetBalance`, `RollbackDebit`, and `HealthCheck`).
4. **Data & Ledger Tier**: Authoritative SQLite database using Node 22's built-in `node:sqlite` in WAL mode. Uses strict integer paise representation (1 Rupee = 100 paise) to prevent floating-point rounding drift, atomic transactions with immediate write locking, and idempotency indexing.

---

## Financial Transaction Integrity Guarantees

- **Integer Paise Representation**: All balances and monetary mutations are tracked strictly in integer paise (`balance_paise INTEGER CHECK (balance_paise >= 0)`). Input amounts with sub-paise fractional decimals (more than 2 decimal places) or non-finite values are rejected at the API boundary.
- **Atomic Two-Phase Mutations**: Debits and credits are executed via atomic SQLite transactions (`BEGIN IMMEDIATE`) with double-entry ledger journaling (`DEBIT`, `CREDIT`, `REVERSAL`).
- **Idempotency with Conflict Detection**: Every transaction is reserved in `idempotency_records`. Identical retries return existing transaction outcomes without re-executing ledger operations; reusing an existing key with altered parameters (different sender, receiver, or amount) is rejected with HTTP 409 Conflict.
- **Race Condition Prevention**: Database-level constraints (`balance_paise >= amount_paise`) prevent concurrent overdrafts even under unsynchronized race conditions.
- **Saga Compensating Rollbacks**: If downstream routing or beneficiary crediting fails or times out, a compensating rollback automatically refunds the debited amount to the sender, updates the transaction to `ROLLBACK_COMPLETED`, and writes an immutable `REVERSAL` ledger record.
- **Late Credit & Split-Brain Protection**: If a delayed receiver credit completes after a rollback was initiated, the atomic database operation checks for existing `REVERSAL` records and cancels the late credit to maintain money conservation.
- **Crash Recovery**: On startup, `recoverInterruptedTransactions()` inspects uncommitted or in-flight records from unexpected shutdowns, automatically executing compensating rollbacks for partial transfers and promoting fully settled legs to `SUCCESS`.

---

## Distributed Systems Features

### Unit I: Remote Procedure Calls (gRPC & REST)
- Binary Protocol Buffers (`protos/account.proto`) with HTTP/2 transport.
- Strongly typed RPC definitions with gRPC status codes (`OK`, `INVALID_ARGUMENT`, `NOT_FOUND`, `FAILED_PRECONDITION`, `INTERNAL`, `DEADLINE_EXCEEDED`).
- Client stub with deadline timers and Lamport logical timestamp propagation in metadata.

### Unit II: Communication & Fault Tolerance
- **Message-Oriented Queue Simulation**: In-process durable message queue with at-least-once delivery semantics and consumer-side deduplication filters.
- **Stream-Oriented WebSocket Multiplexing**: Monotonic sequence numbering, client heartbeat ping/pong, and sequence replay buffers for network disconnect recovery.
- **P2P & WebRTC Signaling**: Direct peer-to-peer transaction route bypassing the central NPCI clearing switch; SCTP DataChannel negotiation.
- **3-State Circuit Breaker**: Closed, Open, and Half-Open states with configurable failure thresholds, recovery timeouts, and trial success counts.

### Unit III: Distributed Synchronization & Coordination
- **Logical & Vector Clocks**: Lamport clock scalar counters and 4-tuple Vector clocks (`[Sender, Transaction, NPCI, Receiver]`) capturing causal dependencies.
- **Clock Synchronization**: Berkeley algorithm master-worker time averaging simulation.
- **Distributed Mutual Exclusion**: Ricart-Agrawala permission-based mutex and Lodha-Kshemkalyani fair mutual exclusion with bounded waiting and restricted multicast.
- **Deadlock Detection**: Knapp's classification (Path-Pushing, Edge-Chasing, Diffusion Computation, Global State Detection) modeling circular wait conditions.
- **Leader Elections**: Bully algorithm and Ring-based election coordination.
- **Consistent Global Snapshots**: Chandy-Lamport state capture recording node states and in-flight channel messages.
- **CAP Theorem & Consistency Experiments**: Simulated network partitions demonstrating CP (Linearizable/Strict with write rejections during partition) vs. AP (Eventual consistency with Last-Write-Wins conflict resolution).

---

## Prerequisites & Installation

- **Node.js**: Version 22 (LTS) or higher
- **npm**: Version 10 or higher

```bash
# Clone the repository
git clone https://github.com/taresanikaa/DS.git
cd DS

# Install all dependencies
npm install
```

---

## Environment Configuration

Copy `.env.example` to `.env` or configure variables as needed:

```bash
# Core Service Configuration
PORT=3000
NODE_ENV=development
SQLITE_DB_PATH=./data/upi_simulator.db

# Fault Tolerance & Circuit Breaker Settings
CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
CIRCUIT_BREAKER_RECOVERY_TIMEOUT=10
CIRCUIT_BREAKER_SUCCESS_THRESHOLD=1
MAX_RETRIES=2
RETRY_DELAY_SECONDS=0.4
REQUEST_TIMEOUT_SECONDS=3

# Security & Secrets Placeholders (change for production)
DB_ENCRYPTION_KEY=change-me
UPI_API_TOKEN=change-me
UPI_HMAC_SECRET=change-me
```

---

## Development & Execution Commands

```bash
# Start unified fullstack development server (Express + Vite + WebSockets + gRPC on 3000)
npm run dev

# Build frontend production bundle into dist/
npm run build

# Start production server
npm start

# Run TypeScript typecheck / lint
npm run lint

# Run the complete test suite (Unit I-IV, synchronization, DB persistence, and integration)
npm test

# Run individual test suites
npm run test:sync          # Distributed synchronization & mutual exclusion tests
npm run test:comm          # Core communication & RPC tests
npm run test:unit2         # Unit II messaging, queue, and fault tolerance tests
npm run test:grpc          # Unit I gRPC client-server tests
npm run test:db            # Phase 3 ACID persistence & 16 financial transaction scenarios
npm run test:consistency   # CAP theorem, replication & consistency model tests
npm run test:integration   # Concurrent race condition and API integration tests
npm run test:deploy        # Unit IV Docker and Kubernetes static invariant tests
npm run test:infra         # Live infrastructure probe (Docker daemon / kubectl)
```

---

## Docker Deployment

The multi-stage `Dockerfile` compiles the frontend in a build stage and runs the production app inside a hardened, unprivileged `node:22-alpine` container with `dumb-init` handling process signals.

### Build and Run with Docker CLI

```bash
# Build Docker image
docker build -t upi-simulator:latest .

# Run container with persistent volume for SQLite
docker run -d \
  --name upi-simulator-app \
  -p 3000:3000 \
  -p 50051:50051 \
  -v upi_simulator_data:/app/data \
  --read-only \
  --tmpfs /tmp \
  --cap-drop=ALL \
  upi-simulator:latest

# Check container health
docker inspect --format='{{json .State.Health.Status}}' upi-simulator-app

# View container logs
docker logs -f upi-simulator-app
```

### Run with Docker Compose

```bash
# Start service in background
docker compose up -d

# Verify service logs
docker compose logs -f

# Check health
curl -s http://localhost:3000/health

# Stop service (preserves named volume data)
docker compose down
```

---

## Kubernetes Deployment

All Kubernetes manifests reside in `k8s/` and follow the Kubernetes v1.26+ API specification.

### Architecture & Storage Safety Rule
Because the authoritative ledger uses SQLite in WAL mode on a `ReadWriteOnce` persistent disk, **the live Deployment is strictly pinned to 1 replica with `type: Recreate`** to prevent multiple pods from corrupting the database file during rollout surges. Multi-node consensus actors are provided as educational demonstration specimens.

### Deploying via Kustomize

```bash
# Step 1: Build or load image into cluster (e.g. Minikube / Kind)
minikube image load upi-simulator:latest
# or for Kind:
# kind load docker-image upi-simulator:latest

# Step 2: Apply all manifests via Kustomize
kubectl apply -k k8s/

# Step 3: Verify resources
kubectl get pods -n upi-simulator
kubectl get pvc -n upi-simulator
kubectl get svc -n upi-simulator

# Step 4: Access the application via port-forwarding
kubectl port-forward -n upi-simulator svc/upi-simulator-service 3000:3000 50051:50051
```

---

## Verified Features & Limitations

| Feature / Subsystem | Status | Verification Evidence |
|---|---|---|
| Integer Paise Monetary Calculations | Verified | `test_db_persistence.ts` Scenario 0 |
| Atomic Debit & Double-Entry Ledger | Verified | `test_db_persistence.ts` Scenarios 1, 9, 13 |
| Idempotency & Conflict Detection | Verified | `test_db_persistence.ts` Scenario 15; API initiate test |
| Concurrent Overdraft Prevention | Verified | `test_integration_race_and_consistency.ts` Section 2-3 |
| Saga Compensating Rollbacks | Verified | `test_db_persistence.ts` Scenario 7 |
| Crash Recovery on Startup | Verified | `test_db_persistence.ts` Scenario 16; `server.ts` startup |
| gRPC Middleware (HTTP/2 Protobuf) | Verified | `test_unit1_grpc.ts` Tests 1-9 on port 50051/50052 |
| Distributed Mutex (Ricart-Agrawala, L-K) | Verified | `test_synchronization.ts` Features 5-6 |
| Vector Clocks & Lamport Timestamps | Verified | `test_synchronization.ts` Features 2-3 |
| Knapp's Deadlock Detection (4 Classes) | Verified | `test_synchronization.ts` Feature 7 |
| CAP Theorem & Consistency Replication | Verified | `test_consistency_experiment.ts` Tests 1-4 |
| Docker & K8s Manifest Invariants | Verified | `test_unit4_deployment.ts` 44/44 assertions passed |
| Live Docker Daemon / Kubernetes Cluster | Environment-Limited | Host container does not run a nested Docker daemon or cluster; validated statically via test suites |
