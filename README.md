# UPI Distributed Transaction Simulator

An interactive educational simulator for understanding distributed systems through a UPI-inspired payment workflow. The project demonstrates how independent banking services coordinate transactions, communicate through multiple protocols, recover from failures, and maintain consistency across distributed nodes.

> **Educational project:** This simulator does not connect to real UPI, NPCI, banks, payment networks, or production financial systems.

## Overview

The application provides a React-based dashboard backed by an Express and WebSocket server. It simulates a transaction moving through a sender bank, an NPCI-style interbank switch, and a receiver bank while visualizing distributed-systems concepts in real time.

The simulator provides a modern, high-contrast **green, orange, and white fintech design system** (inspired by Indian UPI Saffron `#FF6600` and NPCI Emerald `#00875A`) with a unified **single top navbar**:

- **Dashboard:** Interactive system architecture tree showing services, connections, protocols, microservice health probes, and an interactive 6-step transaction flow simulator.
- **Ledger:** Double-entry financial journal with sender/receiver details, exact amounts in INR (`tabular-nums`), timestamps, transaction IDs with copy affordances, status filters (`ALL`, `SETTLED`, `PENDING`, `REVERSED`), and closed-system money conservation verification.
- **Make Transactions:** Dedicated payment orchestration console with input validation, protocol selection (REST, gRPC, WebSocket, P2P/WebRTC, RabbitMQ), quick party presets, and a real-time 5-step Saga execution progress stepper.
- **Part 1 – Unit I:** Distributed systems fundamentals, 6 core design goals (Resource Sharing, Openness, Concurrency, Scalability, Fault Tolerance, Transparency), 4 architectural styles, NPCI hub-and-spoke switch, and live gRPC binary middleware.
- **Part 2 – Unit II:** Communication mechanisms, RPC/gRPC latency & payload comparison, AMQP / RabbitMQ topic queues, WebSockets & WebRTC P2P DataChannel, and 3-state circuit breaker fault tolerance.
- **Part 3 – Unit III:** Implemented synchronization algorithms, Lamport's monotonic logical clocks, distributed mutual exclusion (Ricart-Agrawala & Token-Ring), Lodha-Kshemkalyani fair mutual exclusion (bounded waiting), and an interactive race-condition critical section simulator.
- **Part 4 – Unit IV:** Docker multi-stage containerization, Compose persistence, Kubernetes Deployments, triple health probes, PodSecurity hardening, and multi-replica database isolation rules.

## Architecture

```text
React SPA / Vite Dashboard
          |
          | REST API + WebSocket + WebRTC signaling
          v
Express Transaction Orchestrator
          |
          +-- Sender Bank Service simulator
          +-- NPCI Interbank Switch simulator
          +-- Receiver Bank Service simulator
          |
          +-- Circuit Breakers
          +-- Retry and Timeout Engine
          +-- Saga Rollback Coordinator
          +-- Synchronization Algorithms
          +-- In-Memory Transaction and Ledger State
```

### Transaction flow

1. The client submits a transaction with sender, receiver, amount, mode, and an optional idempotency key.
2. The transaction service validates the request and prevents duplicate processing.
3. The sender bank validates the account and performs an atomic debit.
4. The NPCI simulator routes the transaction for standard REST, gRPC, or RabbitMQ flows.
5. The receiver bank credits the beneficiary account.
6. The transaction service marks the payment as successful and broadcasts timeline events.
7. If a downstream step fails, the sender debit is compensated through a Saga rollback.

For P2P mode, the sender bank communicates directly with the receiver bank and bypasses the NPCI simulator.

## Technology Stack

- **Frontend:** React 18, React Router, Lucide React, CSS
- **Build tool:** Vite 6
- **Backend:** Node.js, Express, TypeScript
- **Real-time communication:** WebSocket (`ws`), WebRTC signaling
- **Protocols modeled:** REST/HTTP, gRPC/HTTP/2, RabbitMQ AMQP, WebSocket, P2P HTTP, WebRTC DataChannel
- **State:** In-memory maps for users, transactions, balances, events, and synchronization state
- **Testing:** TypeScript test runner using `tsx`

## Requirements

- Node.js 18 or newer
- npm

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/sanikatare/DS.git
cd DS
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev
```

Open the application at:

```text
http://localhost:3000
```

The development server starts Express and Vite together and serves the React dashboard with hot module support disabled in the embedded Vite middleware configuration.

### 4. Create a production build

```bash
npm run build
NODE_ENV=production npm start
```

The production server serves the generated Vite files from `dist`.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server with `tsx` |
| `npm run build` | Build the React application with Vite |
| `npm run start` | Start the Node.js server |
| `npm run preview` | Preview the Vite build |
| `npm run lint` | Type-check the project with TypeScript |
| `npm run test:sync` | Run the distributed synchronization algorithm tests |

## Environment Variables

Copy `.env.example` to `.env` when custom behavior is needed:

```bash
cp .env.example .env
```

Important configuration values include:

| Variable | Purpose |
| --- | --- |
| `MAX_RETRIES` | Maximum retry attempts for downstream operations |
| `RETRY_DELAY_SECONDS` | Delay between retry attempts |
| `REQUEST_TIMEOUT_SECONDS` | Timeout for simulated service calls |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | Failures required to open a circuit |
| `CIRCUIT_BREAKER_RECOVERY_TIMEOUT` | Time before an open circuit enters half-open state |
| `CIRCUIT_BREAKER_SUCCESS_THRESHOLD` | Successful trial calls required to close a circuit |
| `VITE_TXN_API_URL` | Frontend transaction API URL |
| `VITE_TXN_WS_URL` | Frontend transaction WebSocket URL |
| `VITE_SENDER_BANK_URL` | Sender bank service URL |
| `VITE_NPCI_URL` | NPCI simulator URL |
| `VITE_RECEIVER_BANK_URL` | Receiver bank service URL |

The application provides local simulator defaults when these values are not set.

## Main API Endpoints

### Transactions and users

- `GET /health` — Transaction service health check
- `GET /api/users` — List simulated users and balances
- `GET /api/stats` — Transaction statistics
- `GET /api/snapshot` — Atomic dashboard snapshot
- `GET /api/transactions` — List transactions, optionally filtered by status
- `GET /api/transaction/:transactionId/status` — Retrieve one transaction
- `POST /api/transaction/initiate` — Start a simulated payment
- `GET /api/ledger` — Inspect journal entries, balances, and ledger invariants

Example transaction request:

```bash
curl -X POST http://localhost:3000/api/transaction/initiate \\
  -H "Content-Type: application/json" \\
  -d '{
    "senderId": "sanika@bank",
    "receiverId": "navya@bank",
    "amount": 500,
    "idempotencyKey": "demo-payment-001",
    "mode": "rest"
  }'
```

Supported transaction modes include:

- `rest`
- `grpc`
- `rabbitmq`
- `p2p` or `peer`

### Fault simulation

- `GET /failure/status` — View failure and circuit-breaker state
- `POST /failure/:target/enable` — Enable a failure for `sender-bank`, `npci`, or `receiver-bank`
- `POST /failure/:target/disable` — Disable a simulated node failure
- `POST /failure/timeout/enable` — Enable timeout simulation
- `POST /failure/timeout/disable` — Disable timeout simulation
- `POST /failure/reset-all` — Restore all services and circuit breakers
- `GET /api/circuit-breaker/status` — View circuit-breaker status
- `POST /api/circuit-breaker/reset` — Reset all circuit breakers

### Synchronization and coordination

- `GET /api/synchronization/clocks` — Physical clock state
- `POST /api/synchronization/clocks/sync` — Synchronize clocks using consensus
- `POST /api/synchronization/clocks/drift` — Introduce clock drift
- `GET /api/synchronization/lamport` — Lamport clocks and event history
- `POST /api/synchronization/lamport/event` — Create a Lamport local, send, or receive event
- `GET /api/synchronization/vector` — Vector clocks and history
- `POST /api/synchronization/vector/event` — Create a vector-clock event
- `POST /api/synchronization/vector/compare` — Compare two vector clocks
- `POST /api/synchronization/global-state/capture` — Capture a Chandy-Lamport snapshot
- `GET /api/synchronization/beacons` — View heartbeat and failure-detection state
- `POST /api/synchronization/election/bully` — Run a Bully election
- `POST /api/synchronization/election/ring` — Run a Ring election
- `POST /api/synchronization/mutex/request` — Request a distributed lock
- `POST /api/synchronization/mutex/release` — Release a distributed lock

## WebSocket and WebRTC

### Transaction event stream

Connect to:

```text
ws://localhost:3000/ws/transactions
```

The transaction stream provides real-time events containing transaction state, service name, timestamps, sequence numbers, Lamport clocks, and vector clocks.

To replay events after a known sequence number:

```text
ws://localhost:3000/ws/transactions?lastSequence=25
```

The stream maintains a bounded replay buffer and supports `ping`, `stats`, and `replay` messages.

### WebRTC signaling

Connect to:

```text
ws://localhost:3000/ws/webrtc?roomId=demo-room&peerId=peer-a
```

The WebRTC endpoint provides signaling support for peer discovery, offers, answers, ICE candidates, joining, and leaving rooms. The server acts as a signaling relay and does not route the actual peer data channel payload.

## Project Structure

```text
.
├── index.html                 # Vite HTML entry point
├── package.json               # Scripts and dependencies
├── server.ts                  # Express, WebSocket, WebRTC, and simulator orchestration
├── test_synchronization.ts    # Synchronization algorithm test suite
├── tsconfig.json              # TypeScript configuration
├── vite.config.ts             # Vite configuration
├── metadata.json              # Project metadata
├── .env.example               # Environment variable template
└── src/
    ├── App.jsx               # Main React application
    ├── api.js                # Frontend API helpers
    ├── main.jsx              # React entry point
    ├── styles.css            # Application styling
    ├── components/            # Reusable UI components
    ├── pages/                 # Dashboard pages and views
    └── server/                # Distributed-systems algorithms and services
```

## Docker Containerization & Docker Compose

The application is fully containerized using a multi-stage `Dockerfile` and a declarative `compose.yaml` specification.

### 1. Multi-Stage Dockerfile Architecture

- **Stage 1 (`builder`)**: Uses `node:22-alpine` to install all dependencies and compile the production React 18 single-page application into `/app/dist` via Vite.
- **Stage 2 (`runner`)**: Uses `node:22-alpine` as a hardened, lightweight production image.
  - Installs `dumb-init` for POSIX signal forwarding (handling `SIGTERM` and `SIGINT` as PID 1), `wget` for health probes, and `su-exec` so an optional root entrypoint can chown `/app/data` then drop privileges.
  - Installs production-only dependencies (`npm ci --omit=dev`), including `tsx` runtime support.
  - Copies `/app/dist`, `server.ts`, `src/server`, `protos/`, and `tsconfig.json`.
  - Starts with `node --experimental-sqlite --import tsx server.ts` so TypeScript and `node:sqlite` both work.
  - Configures dedicated SQLite persistent storage at `/app/data` (`SQLITE_DB_PATH=/app/data/upi_simulator.db`).
  - Enforces least-privilege security by switching to unprivileged user `USER node` (UID 1000).
  - Configures native container `HEALTHCHECK` probing `GET http://127.0.0.1:3000/health`.

### 2. Docker Commands (Direct Container Execution)

#### Build the Docker image
```bash
docker build -t upi-simulator:latest .
```

#### Run the container with a persistent volume
```bash
docker run -d \
  --name upi-simulator-app \
  -p 3000:3000 \
  -p 50051:50051 \
  -v upi_simulator_data:/app/data \
  --restart unless-stopped \
  upi-simulator:latest
```

#### Inspect running container & healthcheck status
```bash
# Check status and health probe output
docker ps --filter "name=upi-simulator-app"

# Inspect detailed health status
docker inspect --format='{{json .State.Health}}' upi-simulator-app
```

#### View application and transaction logs
```bash
docker logs -f upi-simulator-app
```

#### Verify database persistence across container recreation
```bash
# 1. Stop and remove the existing container (the named volume persists)
docker stop upi-simulator-app
docker rm upi-simulator-app

# 2. Start a fresh container mounting the same volume
docker run -d \
  --name upi-simulator-app \
  -p 3000:3000 \
  -p 50051:50051 \
  -v upi_simulator_data:/app/data \
  upi-simulator:latest

# 3. Query existing accounts or ledger to verify persistence
curl http://localhost:3000/api/users
curl http://localhost:3000/api/ledger
```

#### Stop and clean up container
```bash
docker stop upi-simulator-app
docker rm upi-simulator-app
# To optionally delete the data volume:
# docker volume rm upi_simulator_data
```

---

### 3. Docker Compose (`compose.yaml`)

Manage the lifecycle using Docker Compose:

```bash
# Build and start in detached mode
docker compose up -d --build

# Inspect service logs
docker compose logs -f

# Verify container health
docker compose ps

# Stop containers without deleting data
docker compose down

# Stop and wipe persistent volume (fresh start — deletes ledger data)
docker compose down -v
```

### 5. Kubernetes (`k8s/`)

Apply the SQLite-safe overlay:

```bash
kubectl apply -k k8s/
kubectl -n upi-simulator rollout status deployment/upi-simulator
kubectl -n upi-simulator port-forward svc/upi-simulator-service 3000:3000
```

The overlay creates namespace `upi-simulator`, one writer Deployment, ClusterIP Service, ConfigMap, placeholder Secret, RWO PVC, and a PDB. It does **not** apply HPA or extra StatefulSet writers.

Images: `imagePullPolicy: IfNotPresent` with `upi-simulator:latest` is for local/minikube (`minikube image load upi-simulator:latest`). A remote cluster needs a registry image.

Live verification:

```bash
npm run test:infra
```

---

### 4. Database Persistence & Multi-Replica Architecture Considerations

- **Single Container / Docker Compose:** SQLite WAL (Write-Ahead Logging) on a dedicated persistent volume (`/app/data`) provides zero-overhead, crash-resilient ACID storage for accounts and audit journals.
- **Why SQLite cannot be shared across multiple horizontal replicas:** SQLite uses POSIX advisory file locks and shared memory (`-shm`) for concurrency control. Shared network filesystems (e.g., NFS or multi-attach cloud volumes) do not reliably propagate lock states across distinct hosts. Running multiple active write replicas against a single shared SQLite file risks database corruption and lock contention.
- **Kubernetes writer constraint:** The live overlay (`kubectl apply -k k8s/`) deploys **one** backend replica, a `Recreate` strategy, and a `ReadWriteOnce` PVC. RollingUpdate surge and HPA scale-out are not used because two pods cannot safely share this SQLite file.
- **Horizontal Scaling Path (not implemented):** migrate the ledger to PostgreSQL or another multi-writer database before raising replicas. Educational `k8s/hpa.yaml` and `k8s/statefulset.yaml` files are **not** applied.

---

## Running the Automated Test Suites

The project includes unit and integration verification suites executable via `tsx`:

```bash
# Run the complete test suite
npm test

# Run individual test suites
npm run test:sync         # Unit III: Distributed synchronization (Lamport, Vector, Mutex, Deadlock, Elections)
npm run test:comm         # Unit II & IV: Communication paradigms, RMI, DFS, WebRTC
npm run test:grpc         # Unit I: gRPC Protobuf middleware & Account Service (:50051)
npm run test:unit2        # Remote procedure calls, fault tolerance & reconciliation
npm run test:db           # Phase 3: SQLite ACID persistence & 11 transaction scenarios
npm run test:consistency  # Quorum consistency, network partition & conflict resolution
npm run test:deploy       # Unit IV: Dockerfile, Compose, and Kubernetes static validation
npm run test:infra        # Live Docker Compose persistence test and kubectl dry-run / apply when available
npm run lint              # TypeScript static typing verification
```

## Educational Topics Demonstrated

This project can be used as a practical companion for distributed-systems coursework, including:

- Distributed architectures and middleware
- Message passing and remote procedure calls
- Logical and physical clock synchronization
- Causal ordering and concurrency
- Global-state recording
- Failure detection and recovery
- Leader election
- Distributed mutual exclusion
- Fault tolerance and availability trade-offs
- ACID, BASE, Saga, and consistency concepts
- Containerization and orchestration with Docker and Kubernetes

## Limitations & Sandbox Verification Notice

- **Architectural Scope**: The core banking nodes (Sender Bank, NPCI, Receiver Bank) run inside a coordinated distributed simulation process with distinct network protocols, endpoints, and event loops. Docker Compose runs this coordinator container rather than separate virtual machines for each bank.
- **Verification**: `npm run test:deploy` is static/schema validation. `npm run test:infra` builds Compose (when Docker works) and only applies Kubernetes when `kubectl cluster-info` succeeds. Missing tools are reported as skipped, not as passed live deploys.

## License

No license has been specified for this repository yet. Add a license before distributing or reusing the project publicly.
