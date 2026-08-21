import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readCache,
  writeCache,
  getSavedEditor,
  saveEditor,
  computeInputsHash,
  saveGenerateState,
  checkOutdated,
  type HubCacheConfig,
} from "./cache.js";

describe("hub-cache", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hub-cache-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("readCache / writeCache", () => {
    it("should return empty object when no cache exists", async () => {
      const cache = await readCache(tempDir);
      expect(cache).toEqual({});
    });

    it("should write and read cache correctly", async () => {
      const data: HubCacheConfig = {
        editor: "cursor",
        lastGenerate: {
          hash: "abc123",
          timestamp: "2026-02-18T12:00:00Z",
          editor: "cursor",
        },
      };

      await writeCache(tempDir, data);
      const result = await readCache(tempDir);
      expect(result).toEqual(data);
    });

    it("should create .hub directory if it does not exist", async () => {
      await writeCache(tempDir, { editor: "kiro" });
      const result = await readCache(tempDir);
      expect(result.editor).toBe("kiro");
    });

    it("should return empty object on corrupted JSON", async () => {
      await mkdir(join(tempDir, ".hub"), { recursive: true });
      await writeFile(join(tempDir, ".hub", "config.json"), "not-json", "utf-8");
      const result = await readCache(tempDir);
      expect(result).toEqual({});
    });
  });

  describe("getSavedEditor / saveEditor", () => {
    it("should return undefined when no editor is saved", async () => {
      const editor = await getSavedEditor(tempDir);
      expect(editor).toBeUndefined();
    });

    it("should save and retrieve editor preference", async () => {
      await saveEditor(tempDir, "claude-code");
      const editor = await getSavedEditor(tempDir);
      expect(editor).toBe("claude-code");
    });

    it("should overwrite existing editor preference", async () => {
      await saveEditor(tempDir, "cursor");
      await saveEditor(tempDir, "kiro");
      const editor = await getSavedEditor(tempDir);
      expect(editor).toBe("kiro");
    });

    it("should preserve other cache data when saving editor", async () => {
      await writeCache(tempDir, {
        editor: "cursor",
        lastGenerate: {
          hash: "abc",
          timestamp: "2026-01-01T00:00:00Z",
          editor: "cursor",
        },
      });

      await saveEditor(tempDir, "kiro");
      const cache = await readCache(tempDir);
      expect(cache.editor).toBe("kiro");
      expect(cache.lastGenerate?.hash).toBe("abc");
    });
  });

  describe("computeInputsHash", () => {
    it("should return a consistent hash for same inputs", async () => {
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      const hash1 = await computeInputsHash(tempDir);
      const hash2 = await computeInputsHash(tempDir);
      expect(hash1).toBe(hash2);
    });

    it("should return different hash when hub.yaml changes", async () => {
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      const hash1 = await computeInputsHash(tempDir);

      await writeFile(join(tempDir, "hub.yaml"), "name: changed\nrepos: []\n", "utf-8");
      const hash2 = await computeInputsHash(tempDir);

      expect(hash1).not.toBe(hash2);
    });

    it("should include agents directory in hash", async () => {
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      const hash1 = await computeInputsHash(tempDir);

      await mkdir(join(tempDir, "agents"), { recursive: true });
      await writeFile(join(tempDir, "agents", "my-agent.md"), "# My Agent\n", "utf-8");
      const hash2 = await computeInputsHash(tempDir);

      expect(hash1).not.toBe(hash2);
    });

    it("should include skills directory in hash", async () => {
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      const hash1 = await computeInputsHash(tempDir);

      await mkdir(join(tempDir, "skills", "my-skill"), { recursive: true });
      await writeFile(join(tempDir, "skills", "my-skill", "SKILL.md"), "# Skill\n", "utf-8");
      const hash2 = await computeInputsHash(tempDir);

      expect(hash1).not.toBe(hash2);
    });

    it("should include hooks directory in hash", async () => {
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      const hash1 = await computeInputsHash(tempDir);

      await mkdir(join(tempDir, "hooks"), { recursive: true });
      await writeFile(join(tempDir, "hooks", "pre-commit.sh"), "#!/bin/bash\n", "utf-8");
      const hash2 = await computeInputsHash(tempDir);

      expect(hash1).not.toBe(hash2);
    });

    it("should include commands directory in hash", async () => {
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      const hash1 = await computeInputsHash(tempDir);

      await mkdir(join(tempDir, "commands"), { recursive: true });
      await writeFile(join(tempDir, "commands", "deploy.md"), "# Deploy\n", "utf-8");
      const hash2 = await computeInputsHash(tempDir);

      expect(hash1).not.toBe(hash2);
    });

    it("should produce a 64-char hex string (SHA-256)", async () => {
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      const hash = await computeInputsHash(tempDir);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should handle missing hub.yaml gracefully", async () => {
      const hash = await computeInputsHash(tempDir);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("saveGenerateState", () => {
    it("should save hash, timestamp, and editor after generation", async () => {
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      await saveGenerateState(tempDir, "cursor");

      const cache = await readCache(tempDir);
      expect(cache.editor).toBe("cursor");
      expect(cache.lastGenerate).toBeDefined();
      expect(cache.lastGenerate!.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(cache.lastGenerate!.editor).toBe("cursor");
      expect(cache.lastGenerate!.timestamp).toBeTruthy();
    });
  });

  describe("checkOutdated", () => {
    it("should return not outdated when no previous generate exists", async () => {
      const result = await checkOutdated(tempDir);
      expect(result.outdated).toBe(false);
      expect(result.reason).toBe("no-previous-generate");
    });

    it("should return not outdated when inputs have not changed", async () => {
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      await saveGenerateState(tempDir, "cursor");

      const result = await checkOutdated(tempDir);
      expect(result.outdated).toBe(false);
      expect(result.editor).toBe("cursor");
    });

    it("should return outdated when hub.yaml changes", async () => {
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      await saveGenerateState(tempDir, "cursor");

      await writeFile(join(tempDir, "hub.yaml"), "name: changed\nrepos: []\n", "utf-8");
      const result = await checkOutdated(tempDir);
      expect(result.outdated).toBe(true);
      expect(result.editor).toBe("cursor");
      expect(result.reason).toBe("inputs-changed");
    });

    it("should return outdated when an agent is added", async () => {
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      await saveGenerateState(tempDir, "kiro");

      await mkdir(join(tempDir, "agents"), { recursive: true });
      await writeFile(join(tempDir, "agents", "new-agent.md"), "# New\n", "utf-8");

      const result = await checkOutdated(tempDir);
      expect(result.outdated).toBe(true);
      expect(result.editor).toBe("kiro");
    });

    it("should return outdated when a skill is modified", async () => {
      await mkdir(join(tempDir, "skills", "my-skill"), { recursive: true });
      await writeFile(join(tempDir, "skills", "my-skill", "SKILL.md"), "v1\n", "utf-8");
      await writeFile(join(tempDir, "hub.yaml"), "name: test\nrepos: []\n", "utf-8");
      await saveGenerateState(tempDir, "cursor");

      await writeFile(join(tempDir, "skills", "my-skill", "SKILL.md"), "v2\n", "utf-8");
      const result = await checkOutdated(tempDir);
      expect(result.outdated).toBe(true);
    });
  });
});
