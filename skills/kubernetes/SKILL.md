---
name: kubernetes
description: Kubernetes/EKS patterns. Use when managing deployments, pods, troubleshooting containers, viewing logs, or scaling applications.
triggers: [kubernetes, k8s, kubectl, pods, deployments, eks, containers, cluster]
---

# Kubernetes Operations Guide

## When to Use This Skill

Use when managing Kubernetes deployments, troubleshooting pod issues, viewing application logs, scaling services, or debugging container problems.

## Common Operations

### View Resources

```bash
kubectl get pods -n <namespace>
kubectl get pods -n <namespace> -o wide
kubectl get pods -n <namespace> -l app=<app-name>
kubectl get deployments -n <namespace>
kubectl get svc -n <namespace>
kubectl get ingress -n <namespace>
kubectl get all -n <namespace>
```

### Logs

```bash
kubectl logs -n <namespace> <pod-name>
kubectl logs -n <namespace> <pod-name> -f
kubectl logs -n <namespace> <pod-name> --tail=100
kubectl logs -n <namespace> <pod-name> --previous
kubectl logs -n <namespace> -l app=<app-name> --all-containers=true
kubectl logs -n <namespace> <pod-name> --since=1h
```

### Describe & Debug

```bash
kubectl describe pod -n <namespace> <pod-name>
kubectl describe deployment -n <namespace> <deployment>
kubectl get events -n <namespace> --sort-by='.lastTimestamp'
kubectl top pods -n <namespace>
kubectl top nodes
```

### Execute Commands

```bash
kubectl exec -it -n <namespace> <pod-name> -- /bin/sh
kubectl exec -n <namespace> <pod-name> -- cat /app/config.json
kubectl port-forward -n <namespace> svc/<service> <local-port>:<remote-port>
```

### Scaling

```bash
kubectl scale deployment -n <namespace> <deployment> --replicas=<n>
kubectl get hpa -n <namespace>
kubectl describe hpa -n <namespace> <hpa-name>
```

### Rollouts

```bash
kubectl rollout restart deployment -n <namespace> <deployment>
kubectl rollout status deployment -n <namespace> <deployment>
kubectl rollout history deployment -n <namespace> <deployment>
kubectl rollout undo deployment -n <namespace> <deployment>
```

## Troubleshooting

### Pod in CrashLoopBackOff
1. Check logs from previous container: `kubectl logs -n <ns> <pod> --previous`
2. Check events: `kubectl describe pod -n <ns> <pod>`
3. Common causes: missing env vars, secret not synced, DB connection failed, OOMKilled

### Pod in Pending
1. Check events: `kubectl describe pod -n <ns> <pod>`
2. Check node resources: `kubectl top nodes`
3. Common causes: insufficient CPU/memory, node selector mismatch, PVC not bound

### Pod in ImagePullBackOff
1. Verify image exists: `kubectl describe pod -n <ns> <pod> | grep -A5 "Image:"`
2. Check registry authentication

### Service Not Responding
1. Verify pods are running: `kubectl get pods -n <ns> -l app=<app>`
2. Check endpoints: `kubectl get endpoints -n <ns> <service>`
3. Test connectivity: `kubectl run debug --rm -it --image=busybox -- wget -qO- http://<svc>.<ns>.svc.cluster.local`

## Best Practices

1. Always verify context before running commands
2. Use labels for filtering resources
3. Check events first when troubleshooting
4. Don't delete pods without understanding the impact
5. Use `rollout restart` instead of deleting pods
6. Scale gradually — don't jump from 2 to 20 replicas
