#!/usr/bin/env node
/**
 * Seed Night Premiere QoS dashboard + alert into Grafana Cloud.
 * Safe no-op when GRAFANA_URL or GRAFANA_SERVICE_ACCOUNT_TOKEN is missing.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) config({ path: ".env.local" });
else config();

const grafanaUrl = process.env.GRAFANA_URL?.replace(/\/$/, "");
const token = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN;

if (!grafanaUrl || !token) {
  console.log(
    "[seed-grafana] GRAFANA_URL or GRAFANA_SERVICE_ACCOUNT_TOKEN missing — skipping (safe no-op).",
  );
  process.exit(0);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function grafana(path, method, body) {
  const response = await fetch(`${grafanaUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

const dashboard = {
  dashboard: {
    uid: "night-premiere-qos",
    title: "Night Premiere QoS",
    tags: ["cineops", "night-premiere", "eu-west"],
    timezone: "browser",
    schemaVersion: 39,
    panels: [
      {
        id: 1,
        type: "timeseries",
        title: "cineops_buffer_ratio",
        gridPos: { h: 8, w: 8, x: 0, y: 0 },
        targets: [
          {
            refId: "A",
            expr: 'cineops_buffer_ratio{show="night-premiere",region="eu-west"}',
          },
        ],
      },
      {
        id: 2,
        type: "timeseries",
        title: "cineops_origin_5xx",
        gridPos: { h: 8, w: 8, x: 8, y: 0 },
        targets: [
          {
            refId: "A",
            expr: 'cineops_origin_5xx{show="night-premiere",region="eu-west"}',
          },
        ],
      },
      {
        id: 3,
        type: "timeseries",
        title: "cineops_edge_latency",
        gridPos: { h: 8, w: 8, x: 16, y: 0 },
        targets: [
          {
            refId: "A",
            expr: 'cineops_edge_latency{show="night-premiere",region="eu-west"}',
          },
        ],
      },
    ],
  },
  overwrite: true,
};

const alertRule = {
  orgID: 1,
  folderUID: "cineops",
  ruleGroup: "night-premiere",
  title: "NightPremiereBufferRatio",
  condition: "B",
  noDataState: "OK",
  execErrState: "OK",
  for: "1m",
  annotations: {
    summary: "Buffer ratio spike on Night Premiere EU-West",
  },
  labels: {
    show: "night-premiere",
    region: "eu-west",
  },
  data: [
    {
      refId: "A",
      relativeTimeRange: { from: 600, to: 0 },
      datasourceUid: "prometheus",
      model: {
        expr: 'cineops_buffer_ratio{show="night-premiere",edge="eu-west-edge-3"}',
        refId: "A",
      },
    },
    {
      refId: "B",
      relativeTimeRange: { from: 0, to: 0 },
      datasourceUid: "__expr__",
      model: {
        type: "threshold",
        refId: "B",
        conditions: [
          {
            evaluator: { type: "gt", params: [0.25] },
          },
        ],
      },
    },
  ],
};

try {
  await grafana("/api/folders", "POST", { uid: "cineops", title: "CineOps" }).catch(() => {
    console.log("[seed-grafana] Folder may already exist — continuing.");
  });
  const dash = await grafana("/api/dashboards/db", "POST", dashboard);
  console.log("[seed-grafana] Dashboard upserted:", dash.url ?? dash.status ?? "ok");
  try {
    await grafana("/api/v1/provisioning/alert-rules", "POST", alertRule);
    console.log("[seed-grafana] Alert NightPremiereBufferRatio created.");
  } catch (error) {
    console.log("[seed-grafana] Alert create skipped:", error instanceof Error ? error.message : error);
  }
  console.log(
    "[seed-grafana] Synthetic series expected: cineops_buffer_ratio, cineops_origin_5xx, cineops_edge_latency{edge,region,show=\"night-premiere\"} with eu-west-edge-3 as the outlier.",
  );
} catch (error) {
  console.error("[seed-grafana] Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
