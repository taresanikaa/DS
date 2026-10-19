# Kubernetes Deployment & Container Orchestration Guide — UPI Simulator

This guide documents the production-grade Kubernetes deployment architecture for the **UPI Distributed Transaction Simulator** following the Kubernetes v1.26+ API specification.

---

## 1. Architectural Layout & Resource Topology

```text
[ External / Port-Forward / Ingress Traffic ]
           │
           ▼
[ Service: upi-simulator-service (ClusterIP :3000 HTTP, :50051 gRPC) ]
           │
           ▼ (Pinned Single-Writer Architecture)
┌─────────────────────────────────────────────────────────────┐
│  Deployment: upi-simulator (1 Replica, Recreate Strategy)   │
│  - Authoritative SQLite Writer (Strict 1 Replica)           │
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
│  StatefulSet: upi-consensus-nodes (Educational Specimen)    │
│  - Bank Alpha (node-0), Bank Beta (node-1), NPCI Hub (node-2)│
│  - Educational specimen for peer-to-peer actor discovery    │
│  - Not deployed as live extra SQLite writers                │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Kubernetes Manifest Inventory

| File | API Version | Kind | Purpose |
|---|---|---|---|
| `k8s/configmap.yaml` | `v1` | `ConfigMap` | Non-sensitive cluster configuration parameters and timeout values. |
| `k8s/secret.yaml` | `v1` | `Secret` | Placeholder HMAC signing keys, API tokens, and encryption secrets. |
| `k8s/pvc.yaml` | `v1` | `PersistentVolumeClaim` | 1Gi `ReadWriteOnce` persistent storage for single authoritative SQLite writer across pod restarts. |
| `k8s/deployment.yaml` | `apps/v1` | `Deployment` | 1 replica of UPI orchestrator with `type: Recreate` (avoids RWO dual-mount), hardened securityContext, and probes. |
| `k8s/statefulset.yaml` | `apps/v1` | `StatefulSet` | Educational specimen for distributed actor consensus discovery (not applied as extra live writers). |
| `k8s/service.yaml` | `v1` | `Service` | Portable `ClusterIP` service exposing HTTP on port `3000` and gRPC on port `50051`. |
| `k8s/headless-service.yaml` | `v1` | `Service` | Headless Service (`clusterIP: None`) for peer-to-peer actor DNS resolution. |
| `k8s/hpa.yaml` | `autoscaling/v2` | `HorizontalPodAutoscaler` | Educational HPA specimen configured with scale-up disabled to prevent multiple SQLite writer corruption. |
| `k8s/pdb.yaml` | `policy/v1` | `PodDisruptionBudget` | Configured to allow pod eviction during voluntary node maintenance. |
| `k8s/kustomization.yaml` | `kustomize.config.k8s.io/v1beta1` | `Kustomization` | Single entry point deploying live resources: namespace, configmap, secret, pvc, deployment, service, pdb. |

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
