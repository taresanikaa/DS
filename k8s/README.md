# Kubernetes Deployment & Container Orchestration Guide — UPI Simulator

This guide documents the production-grade Kubernetes deployment architecture for the **UPI Distributed Transaction Simulator** following the Kubernetes v1.26+ API specification.

---

## 1. Architectural Layout & Resource Topology

```text
[ External / Ingress Traffic ]
           │
           ▼
[ Service: upi-simulator-service (NodePort :30080 -> :3000) ]
           │
           ▼ (Round-Robin Load Distribution)
┌─────────────────────────────────────────────────────────────┐
│  Deployment: upi-simulator (2 Replicas, RollingUpdate)      │
│  - Image: upi-simulator:latest (Non-root UID 1000)          │
│  - Security: readOnlyRootFilesystem, drop ALL capabilities   │
│  - Probes: Startup, Liveness, Readiness on /health          │
│  - Volume: PVC (upi-data-pvc) on /app/data (SQLite WAL)     │
│  - Volume: emptyDir on /tmp                                 │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
[ Headless Service: upi-nodes-headless (clusterIP: None) ]
           │
           ▼ (Stable Network Identities: node-0, node-1, node-2)
┌─────────────────────────────────────────────────────────────┐
│  StatefulSet: upi-consensus-nodes (3 Replicas)              │
│  - Bank Alpha (node-0), Bank Beta (node-1), NPCI Hub (node-2)│
│  - VolumeClaimTemplates: 500Mi per replica                  │
│  - Peer-to-Peer Actor Discovery & Vector Clock Sync         │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Kubernetes Manifest Inventory

| File | API Version | Kind | Purpose |
|---|---|---|---|
| `k8s/configmap.yaml` | `v1` | `ConfigMap` | Non-sensitive cluster configuration parameters and timeout values. |
| `k8s/secret.yaml` | `v1` | `Secret` | Sensitive HMAC signing keys, API tokens, and encryption secrets. |
| `k8s/pvc.yaml` | `v1` | `PersistentVolumeClaim` | 1Gi `ReadWriteOnce` persistent storage for SQLite WAL persistence across pod restarts. |
| `k8s/deployment.yaml` | `apps/v1` | `Deployment` | 2 replicas of UPI orchestrator with `maxSurge: 1, maxUnavailable: 0`, hardened securityContext, and probes. |
| `k8s/statefulset.yaml` | `apps/v1` | `StatefulSet` | 3 replicas for distributed synchronization nodes with headless service and volume templates. |
| `k8s/service.yaml` | `v1` | `Service` | NodePort service exposing the API and WebSocket simulator on port `30080`. |
| `k8s/headless-service.yaml` | `v1` | `Service` | Headless Service (`clusterIP: None`) for peer-to-peer actor DNS resolution. |
| `k8s/hpa.yaml` | `autoscaling/v2` | `HorizontalPodAutoscaler` | Autoscaling from 2 to 10 pods based on CPU (70%) and Memory (80%). |
| `k8s/pdb.yaml` | `policy/v1` | `PodDisruptionBudget` | Guarantees at least 1 replica remains available during voluntary disruptions. |
| `k8s/kustomization.yaml` | `kustomize.config.k8s.io/v1beta1` | `Kustomization` | Single entry point to deploy all resources deterministically. |

---

## 3. Environment Notice & Execution Constraints

> **CRITICAL ENVIRONMENT NOTE**: The sandbox execution environment is a lightweight container runtime that does **not** host a native nested Docker daemon or local Kubernetes cluster (Minikube / Kind).  
> All configurations and manifests have been syntactically and architecturally validated via `npm run test:deploy` and `tsx test_unit4_deployment.ts`.  
> Follow the local execution steps below to run these manifests on your local workstation with Docker, Minikube, or Kind.

---

## 4. Local Deployment Instructions

### Step 1: Build the Docker Image
```bash
docker build -t upi-simulator:latest .
```

### Step 2: Load into Local Cluster

**For Minikube:**
```bash
minikube image load upi-simulator:latest
# Or build directly inside Minikube's Docker daemon:
eval $(minikube docker-env)
docker build -t upi-simulator:latest .
```

**For Kind:**
```bash
kind load docker-image upi-simulator:latest --name <cluster-name>
```

### Step 3: Deploy All Resources via Kustomize
```bash
kubectl apply -k k8s/
```

### Step 4: Verify Deployment and Services
```bash
# Verify pod statuses
kubectl get pods -l app=upi-simulator
kubectl get pods -l app=upi-consensus

# Verify services
kubectl get svc upi-simulator-service upi-nodes-headless

# Verify PVC and storage binding
kubectl get pvc upi-data-pvc

# Verify HPA and PDB
kubectl get hpa upi-simulator-hpa
kubectl get pdb upi-simulator-pdb
```

### Step 5: Test Rolling Updates & Zero Downtime
```bash
# Trigger rolling update
kubectl set image deployment/upi-simulator upi-simulator=upi-simulator:v1.0.1

# Monitor rollout status
kubectl rollout status deployment/upi-simulator
```

### Step 6: Test Self-Healing & Pod Recovery
```bash
# Terminate a running pod to verify immediate replica recovery
kubectl delete pod -l app=upi-simulator --now

# Observe new pod starting up and passing health probes
kubectl get pods -l app=upi-simulator -w
```

### Step 7: Access the Application
- **Minikube NodePort tunnel:**
  ```bash
  minikube service upi-simulator-service
  ```
- **Port Forwarding:**
  ```bash
  kubectl port-forward svc/upi-simulator-service 3000:80
  ```
  Then navigate to `http://localhost:3000` in your web browser.
