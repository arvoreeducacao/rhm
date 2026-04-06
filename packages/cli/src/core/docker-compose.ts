import { stringify } from "yaml";
import { resolve } from "node:path";
import type { Service } from "./hub-config.js";

const SANDBOX_IMAGE = "ghcr.io/agent-infra/sandbox:latest";
const SANDBOX_PORT = 8080;

function buildSandboxEntry(svc: Service, hubDir: string): Record<string, unknown> {
  const port = svc.port ?? SANDBOX_PORT;
  const workspacePath = resolve(hubDir, svc.workspace ?? ".");

  return {
    image: SANDBOX_IMAGE,
    container_name: svc.name,
    restart: "unless-stopped",
    security_opt: ["seccomp:unconfined"],
    shm_size: "2gb",
    extra_hosts: ["host.docker.internal:host-gateway"],
    ports: [`${port}:8080`],
    volumes: [`${workspacePath}:/workspace`],
    environment: {
      WORKSPACE: "/workspace",
      ...(svc.env ?? {}),
    },
  };
}

export function generateDockerCompose(services: Service[], hubDir: string = process.cwd()): string {
  const compose: Record<string, unknown> = {
    services: {} as Record<string, unknown>,
  };

  const svcMap = compose.services as Record<string, unknown>;
  const volumes: Record<string, unknown> = {};

  for (const svc of services) {
    if (svc.type === "sandbox") {
      svcMap[svc.name] = buildSandboxEntry(svc, hubDir);
      continue;
    }

    const entry: Record<string, unknown> = {
      image: svc.image,
      restart: "unless-stopped",
    };

    if (svc.port) {
      entry.ports = [`${svc.port}:${svc.port}`];
    } else if (svc.ports?.length) {
      entry.ports = svc.ports.map((p) => `${p}:${p}`);
    }

    if (svc.env) {
      entry.environment = svc.env;
    }

    const dataDir = guessDataDir(svc.image ?? svc.name);
    entry.volumes = [`${svc.name}_data:/var/lib/${dataDir}`];
    volumes[`${svc.name}_data`] = null;

    svcMap[svc.name] = entry;
  }

  if (Object.keys(volumes).length > 0) {
    compose.volumes = volumes;
  }

  return stringify(compose, { lineWidth: 120 });
}

function guessDataDir(image: string): string {
  const img = image.split(":")[0].split("/").pop() || "";
  if (img.includes("mysql") || img.includes("mariadb")) return "mysql";
  if (img.includes("postgres")) return "postgresql/data";
  if (img.includes("redis")) return "redis";
  if (img.includes("elasticsearch") || img.includes("opensearch")) return "elasticsearch";
  if (img.includes("qdrant")) return "qdrant";
  if (img.includes("mongo")) return "mongo";
  return img;
}