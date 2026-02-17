---
name: aws
description: AWS infrastructure patterns. Use when working with AWS services, secrets, ECS/EKS, RDS, S3, CloudWatch, or debugging infrastructure issues.
triggers: [aws, amazon, cloud, secrets, ecs, eks, rds, s3, cloudwatch, infrastructure]
---

# AWS Infrastructure Guide

## When to Use This Skill

Use when working with AWS Secrets Manager, debugging ECS/EKS deployments, managing RDS databases, troubleshooting infrastructure, or deploying applications.

## Secrets Management

```bash
aws secretsmanager list-secrets
aws secretsmanager get-secret-value --secret-id <secret-name>
aws secretsmanager update-secret --secret-id <secret-name> --secret-string '{"key":"value"}'
aws secretsmanager create-secret --name <name> --secret-string '{"key":"value"}'
```

## ECS Operations

```bash
aws ecs list-clusters
aws ecs list-services --cluster <cluster>
aws ecs describe-services --cluster <cluster> --services <service>
aws ecs list-tasks --cluster <cluster> --service-name <service>
aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment
```

## RDS Operations

```bash
aws rds describe-db-clusters
aws rds describe-db-instances
aws rds describe-db-cluster-endpoints --db-cluster-identifier <cluster>
```

## S3 Operations

```bash
aws s3 ls
aws s3 ls s3://<bucket>/<prefix>/
aws s3 cp <file> s3://<bucket>/<path>/
aws s3 sync ./local-dir s3://<bucket>/<prefix>/
```

## CloudWatch Logs

```bash
aws logs describe-log-groups
aws logs tail <log-group> --follow
aws logs filter-log-events --log-group-name <group> --filter-pattern "ERROR"
```

## Troubleshooting

### ECS Service Not Starting
1. Check service events: `aws ecs describe-services --cluster <cluster> --services <service> --query 'services[0].events[:5]'`
2. Check task definition: `aws ecs describe-task-definition --task-definition <task-def>`
3. Check CloudWatch logs for errors

### RDS Connection Issues
1. Check cluster status: `aws rds describe-db-clusters --query 'DBClusters[0].Status'`
2. Verify security groups allow traffic
3. Check credentials in secrets

### Secret Not Found
1. Verify secret exists: `aws secretsmanager describe-secret --secret-id <name>`
2. Check IAM permissions for the service role
3. Verify the correct AWS region

## Security Best Practices

1. Never log secret values — use `describe_secret` for metadata only
2. Rotate secrets regularly
3. Use least privilege IAM permissions
4. Tag resources for cost allocation and organization
5. Enable audit logging via CloudTrail
