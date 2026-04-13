import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import chalk from "chalk";
import type { AuditResult, OpenClawConfig } from "../types.js";
import { expandPath, loadConfig } from "../utils/config.js";

const SNAPSHOT_DIR = join(homedir(), ".agent-optimizer", "snapshots");

interface Snapshot {
  timestamp: string;
  host: string;
  configPath: string;
  config: OpenClawConfig;
}

function getSnapshotPath(name: string): string {
  return join(SNAPSHOT_DIR, `${name}.json`);
}

/**
 * Save a golden config snapshot.
 */
export function saveSnapshot(configPath: string, name: string): void {
  const config = loadConfig(configPath);
  if (!config) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const snapshot: Snapshot = {
    timestamp: new Date().toISOString(),
    host: homedir().split("/").pop() ?? "unknown",
    configPath: expandPath(configPath),
    config,
  };

  writeFileSync(getSnapshotPath(name), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  console.log(chalk.green(`\n✓ Snapshot saved: ${name}`));
  console.log(chalk.dim(`  Path: ${getSnapshotPath(name)}`));
  console.log(chalk.dim(`  Config: ${expandPath(configPath)}`));
  console.log(chalk.dim(`  Time: ${snapshot.timestamp}\n`));
}

/**
 * List saved snapshots.
 */
export function listSnapshots(): void {
  if (!existsSync(SNAPSHOT_DIR)) {
    console.log(chalk.yellow("\nNo snapshots saved yet."));
    console.log(chalk.dim("Create one: agent-optimizer snapshot save --name my-golden-config\n"));
    return;
  }

  const files = (readdirSync(SNAPSHOT_DIR) as string[]).filter((f: string) => f.endsWith(".json"));

  if (files.length === 0) {
    console.log(chalk.yellow("\nNo snapshots saved yet."));
    console.log(chalk.dim("Create one: agent-optimizer snapshot save --name my-golden-config\n"));
    return;
  }

  console.log(chalk.bold("\n📸 Saved Snapshots\n"));
  for (const file of files) {
    const name = file.replace(".json", "");
    try {
      const snap = JSON.parse(readFileSync(join(SNAPSHOT_DIR, file), "utf-8")) as Snapshot;
      const age = Math.round((Date.now() - new Date(snap.timestamp).getTime()) / 86400000);
      console.log(`  ${chalk.white(name.padEnd(25))} ${chalk.dim(snap.timestamp)} (${age}d ago)`);
    } catch {
      console.log(`  ${chalk.white(name.padEnd(25))} ${chalk.red("corrupt")}`);
    }
  }
  console.log();
}

/**
 * Compare current config against a saved snapshot.
 */
export function detectDrift(configPath: string, snapshotName: string): AuditResult[] {
  const results: AuditResult[] = [];
  const snapPath = getSnapshotPath(snapshotName);

  if (!existsSync(snapPath)) {
    results.push({
      category: "Config Drift",
      check: "Snapshot exists",
      status: "fail",
      message: `Snapshot "${snapshotName}" not found`,
      fix: `Save one first: agent-optimizer snapshot save --name ${snapshotName}`,
    });
    return results;
  }

  const snapshot = JSON.parse(readFileSync(snapPath, "utf-8")) as Snapshot;
  const current = loadConfig(configPath);

  if (!current) {
    results.push({
      category: "Config Drift",
      check: "Current config",
      status: "fail",
      message: `Config not found: ${configPath}`,
    });
    return results;
  }

  const snapAge = Math.round((Date.now() - new Date(snapshot.timestamp).getTime()) / 86400000);
  results.push({
    category: "Config Drift",
    check: "Snapshot",
    status: "info",
    message: `Comparing against "${snapshotName}" (${snapAge} days old)`,
  });

  const drifts: { path: string; was: unknown; now: unknown }[] = [];

  // Compare key config values
  const checks: { path: string; get: (c: OpenClawConfig) => unknown }[] = [
    { path: "model.primary", get: (c) => c.agents?.defaults?.model?.primary },
    { path: "model.fallbacks", get: (c) => JSON.stringify(c.agents?.defaults?.model?.fallbacks ?? []) },
    { path: "contextTokens", get: (c) => c.agents?.defaults?.contextTokens },
    { path: "heartbeat.every", get: (c) => c.agents?.defaults?.heartbeat?.every },
    { path: "heartbeat.lightContext", get: (c) => c.agents?.defaults?.heartbeat?.lightContext },
    { path: "compaction.mode", get: (c) => c.agents?.defaults?.compaction?.mode },
    { path: "compaction.model", get: (c) => c.agents?.defaults?.compaction?.model },
    { path: "contextPruning.mode", get: (c) => c.agents?.defaults?.contextPruning?.mode },
    { path: "contextPruning.ttl", get: (c) => c.agents?.defaults?.contextPruning?.ttl },
    { path: "maxConcurrent", get: (c) => c.agents?.defaults?.maxConcurrent },
    { path: "subagents.maxConcurrent", get: (c) => c.agents?.defaults?.subagents?.maxConcurrent },
    { path: "thinkingDefault", get: (c) => c.agents?.defaults?.thinkingDefault },
    { path: "plugins.allow", get: (c) => JSON.stringify(c.plugins?.allow ?? []) },
    { path: "tools.alsoAllow", get: (c) => JSON.stringify(c.agents?.list?.[0]?.tools?.alsoAllow ?? []) },
    { path: "tools.deny", get: (c) => JSON.stringify(c.agents?.list?.[0]?.tools?.deny ?? []) },
  ];

  for (const check of checks) {
    const was = check.get(snapshot.config);
    const now = check.get(current);

    if (was !== undefined && now !== undefined && String(was) !== String(now)) {
      drifts.push({ path: check.path, was, now });
    } else if (was !== undefined && now === undefined) {
      drifts.push({ path: check.path, was, now: "(removed)" });
    } else if (was === undefined && now !== undefined) {
      drifts.push({ path: check.path, was: "(not set)", now });
    }
  }

  // Check for new/removed models in models config
  const snapModels = Object.keys(snapshot.config.agents?.defaults?.models ?? {}).sort();
  const currentModels = Object.keys(current.agents?.defaults?.models ?? {}).sort();

  const addedModels = currentModels.filter((m) => !snapModels.includes(m));
  const removedModels = snapModels.filter((m) => !currentModels.includes(m));

  if (addedModels.length > 0) {
    results.push({
      category: "Config Drift",
      check: "Models added",
      status: "info",
      message: `New models since snapshot: ${addedModels.join(", ")}`,
    });
  }

  if (removedModels.length > 0) {
    results.push({
      category: "Config Drift",
      check: "Models removed",
      status: "warn",
      message: `Models removed since snapshot: ${removedModels.join(", ")}`,
    });
  }

  // Check for new/removed plugins
  const snapPlugins = (snapshot.config.plugins?.allow ?? []).sort();
  const currentPlugins = ((current.plugins?.allow ?? []) as string[]).sort();

  const addedPlugins = currentPlugins.filter((p) => !snapPlugins.includes(p));
  const removedPlugins = snapPlugins.filter((p) => !currentPlugins.includes(p));

  if (addedPlugins.length > 0) {
    results.push({
      category: "Config Drift",
      check: "Plugins added",
      status: "info",
      message: `New plugins: ${addedPlugins.join(", ")}`,
    });
  }

  if (removedPlugins.length > 0) {
    results.push({
      category: "Config Drift",
      check: "Plugins removed",
      status: "warn",
      message: `Plugins removed: ${removedPlugins.join(", ")}`,
    });
  }

  // Report drifts
  if (drifts.length === 0 && addedModels.length === 0 && removedModels.length === 0 && addedPlugins.length === 0 && removedPlugins.length === 0) {
    results.push({
      category: "Config Drift",
      check: "Drift detected",
      status: "pass",
      message: "No drift — config matches snapshot",
    });
  } else {
    for (const drift of drifts) {
      const isCritical = ["model.primary", "plugins.allow", "tools.alsoAllow", "tools.deny"].includes(drift.path);
      results.push({
        category: "Config Drift",
        check: `Changed: ${drift.path}`,
        status: isCritical ? "warn" : "info",
        message: `${String(drift.was)} → ${String(drift.now)}`,
      });
    }

    results.push({
      category: "Config Drift",
      check: "Drift summary",
      status: drifts.some((d) => ["model.primary", "plugins.allow"].includes(d.path)) ? "warn" : "info",
      message: `${drifts.length} setting(s) changed, ${addedModels.length + addedPlugins.length} added, ${removedModels.length + removedPlugins.length} removed since snapshot`,
    });
  }

  return results;
}
