#!/usr/bin/env node
/**
 * Host official mcp-grafana over Streamable HTTP for Vercel / Cloud Run clients.
 *
 * Local:
 *   npm run mcp:grafana
 *
 * Production:
 *   Deploy this process on Cloud Run / Fly and set
 *   GRAFANA_MCP_TRANSPORT=http + GRAFANA_MCP_URL=https://…/mcp on Vercel.
 *
 * Requires: GRAFANA_URL, GRAFANA_SERVICE_ACCOUNT_TOKEN, and `uvx` on PATH.
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

if (existsSync(".env.local")) config({ path: ".env.local", override: true });
else config();

const grafanaUrl = process.env.GRAFANA_URL;
const token = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN;
const orgId = process.env.GRAFANA_ORG_ID?.trim();
const port = process.env.GRAFANA_MCP_PORT ?? "8000";

if (!grafanaUrl || !token) {
  console.error(
    "[mcp-grafana-http] Set GRAFANA_URL and GRAFANA_SERVICE_ACCOUNT_TOKEN before starting.",
  );
  process.exit(1);
}

const command = process.platform === "win32" ? "uvx.exe" : "uvx";
const args = [
  "mcp-grafana",
  "--transport",
  "streamable-http",
  "--address",
  `0.0.0.0:${port}`,
  "--endpoint-path",
  "/mcp",
];

console.log(`[mcp-grafana-http] Starting ${command} ${args.join(" ")}`);
console.log(`[mcp-grafana-http] Point GRAFANA_MCP_URL at http://127.0.0.1:${port}/mcp`);
console.log(`[mcp-grafana-http] GRAFANA_MCP_TRANSPORT=http`);
console.log(
  orgId
    ? `[mcp-grafana-http] GRAFANA_ORG_ID=${orgId}`
    : "[mcp-grafana-http] GRAFANA_ORG_ID unset — create_incident may fail (IRM org 0).",
);

const child = spawn(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    GRAFANA_URL: grafanaUrl,
    GRAFANA_SERVICE_ACCOUNT_TOKEN: token,
    ...(orgId ? { GRAFANA_ORG_ID: orgId } : {}),
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
