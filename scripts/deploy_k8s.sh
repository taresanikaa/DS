#!/usr/bin/env bash
# Kubernetes deployment helper for the UPI simulator.
# Live apply is performed only when a cluster is reachable.
set -eo pipefail

echo "============================================================================"
echo "UPI Distributed Simulator — Kubernetes orchestration"
echo "============================================================================"

if ! command -v docker >/dev/null 2>&1; then
  echo "[!] Docker is not installed or not in PATH."
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "[!] kubectl is not installed or not in PATH."
  echo "    Running static TypeScript validation instead."
  npx tsx test_unit4_deployment.ts
  exit 0
fi

echo "[*] Client-side dry-run"
kubectl apply -k k8s/ --dry-run=client

if kubectl cluster-info >/dev/null 2>&1; then
  echo "[*] Cluster detected. Building image upi-simulator:latest"
  if command -v docker >/dev/null 2>&1; then
    docker build -t upi-simulator:latest .
    if command -v minikube >/dev/null 2>&1 && minikube status >/dev/null 2>&1; then
      echo "[*] Loading image into minikube"
      minikube image load upi-simulator:latest
    else
      echo "[!] Image is local. A remote cluster will not see upi-simulator:latest unless you push it to a registry and update imagePullPolicy."
    fi
  fi
  echo "[*] Applying kustomize overlay"
  kubectl apply -k k8s/
  kubectl -n upi-simulator rollout status deployment/upi-simulator --timeout=180s
  kubectl -n upi-simulator get pods,svc,pvc
  echo "[*] Access the API with: kubectl -n upi-simulator port-forward svc/upi-simulator-service 3000:3000"
else
  echo "[*] No reachable cluster. Dry-run completed. Live apply was not performed."
fi
