import { stringify } from "yaml";
import type { Service } from "./hub-config.js";

export function generateDockerCompose(services: Service[]): string {
  const compose: Record<string, unknown> = {
    services: {} as Record<string, unknown>,
  };

  const svcMap = compose.services as Record<string, unknown>;

  for (const svc of services) {
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

    entry.volumes = [`${svc.name}_data:/var/lib/${guessDataDir(svc.image)}`];

    svcMap[svc.name] = entry;
  }

  const volumes: Record<string, unknown> = {};
  for (const svc of services) {
    volumes[`${svc.name}_data`] = null;
  }
  compose.volumes = volumes;

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
