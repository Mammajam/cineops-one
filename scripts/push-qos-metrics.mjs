#!/usr/bin/env node
/**
 * Push Night Premiere cineops_* QoS samples so PromQL has an outlier on eu-west-edge-3.
 * Demo data only — Gemini still owns the isolate verdict at runtime.
 *
 * GRAFANA_METRICS_WRITE_URL = Grafana Cloud Influx write endpoint, e.g.
 *   https://influx-prod-XX.grafana.net/api/v1/push/influx/write
 * Auth: GRAFANA_METRICS_USER + GRAFANA_METRICS_PASSWORD (instance id + token)
 *   or GRAFANA_SERVICE_ACCOUNT_TOKEN as Bearer.
 *
 * Safe no-op when the write URL is missing.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) config({ path: ".env.local" });
else config();

const writeUrl = process.env.GRAFANA_METRICS_WRITE_URL?.trim();
const user = process.env.GRAFANA_METRICS_USER?.trim();
const password = process.env.GRAFANA_METRICS_PASSWORD?.trim();
const token = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN?.trim();

if (!writeUrl) {
  console.log(
    "[push-qos] GRAFANA_METRICS_WRITE_URL missing — skipping (safe no-op).",
  );
  console.log(
    "[push-qos] Set Influx write URL from Grafana Cloud → Connections → Prometheus/Influx.",
  );
  process.exit(0);
}

const headers = {
  "Content-Type": "text/plain; charset=utf-8",
};

if (user && password) {
  headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
} else if (token) {
  headers.Authorization = `Bearer ${token}`;
} else {
  console.log(
    "[push-qos] Need GRAFANA_METRICS_USER+PASSWORD or GRAFANA_SERVICE_ACCOUNT_TOKEN — skipping.",
  );
  process.exit(0);
}

const ns = Date.now() * 1e6;
const lines = [
  `cineops_buffer_ratio,edge=eu-west-edge-1,region=eu-west,show=night-premiere value=0.11 ${ns}`,
  `cineops_buffer_ratio,edge=eu-west-edge-2,region=eu-west,show=night-premiere value=0.12 ${ns}`,
  `cineops_buffer_ratio,edge=eu-west-edge-3,region=eu-west,show=night-premiere value=0.41 ${ns}`,
  `cineops_origin_5xx,edge=eu-west-edge-1,region=eu-west,show=night-premiere value=0.2 ${ns}`,
  `cineops_origin_5xx,edge=eu-west-edge-2,region=eu-west,show=night-premiere value=0.1 ${ns}`,
  `cineops_origin_5xx,edge=eu-west-edge-3,region=eu-west,show=night-premiere value=12.4 ${ns}`,
  `cineops_edge_latency,edge=eu-west-edge-1,region=eu-west,show=night-premiere value=48 ${ns}`,
  `cineops_edge_latency,edge=eu-west-edge-2,region=eu-west,show=night-premiere value=52 ${ns}`,
  `cineops_edge_latency,edge=eu-west-edge-3,region=eu-west,show=night-premiere value=310 ${ns}`,
].join("\n");

const response = await fetch(writeUrl, {
  method: "POST",
  headers,
  body: lines,
});

if (!response.ok) {
  const text = await response.text();
  console.error(`[push-qos] Write failed ${response.status}: ${text.slice(0, 400)}`);
  process.exit(1);
}

console.log(
  "[push-qos] Wrote cineops_buffer_ratio, cineops_origin_5xx, cineops_edge_latency for three EU-West edges (edge-3 outlier).",
);
