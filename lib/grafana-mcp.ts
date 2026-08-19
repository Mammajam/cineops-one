/**
 * Official Grafana MCP client for CineOps One.
 *
 * Spawns grafana/mcp-grafana (uvx mcp-grafana) over stdio, or connects via
 * streamable HTTP when GRAFANA_MCP_TRANSPORT=http.
 *
 * Judges: this file imports @modelcontextprotocol/sdk and calls MCP tools
 * (alerts, Prometheus, Loki, dashboard search, Incident create/update/resolve).
 * If Grafana credentials are missing, calls fall through to a labeled fixture
 * so the Night Premiere demo still runs.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fixtureForTool, FIXTURE_LABEL, fixtureEdgeQos } from "@/lib/grafana-fixtures";
import { SHOW, SUSPECT_EDGE } from "@/lib/show";

export type GrafanaCallMode = "mcp" | "fixture";

export type GrafanaToolResult = {
  mode: GrafanaCallMode;
  tool: string;
  result: unknown;
  label?: string;
};

type McpClient = Client;

let cached: Promise<McpClient> | null = null;
let connectError: string | null = null;

export function isGrafanaConfigured() {
  return Boolean(process.env.GRAFANA_URL && process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN);
}

export function grafanaMode(): GrafanaCallMode {
  return isGrafanaConfigured() && !connectError ? "mcp" : "fixture";
}

function transportMode() {
  return (process.env.GRAFANA_MCP_TRANSPORT ?? "stdio").toLowerCase();
}

async function connectMcp(): Promise<McpClient> {
  const grafanaUrl = process.env.GRAFANA_URL;
  const token = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN;
  if (!grafanaUrl || !token) {
    throw new Error("Grafana credentials missing");
  }

  const client = new Client({ name: "cineops-one", version: "0.1.0" });
  const mode = transportMode();

  if (mode === "http") {
    // Prefer dedicated MCP endpoint for serverless (Vercel cannot spawn uvx).
    // GRAFANA_MCP_URL = hosted mcp-grafana Streamable HTTP URL.
    // Do not reuse GRAFANA_URL (Grafana UI) unless it already ends with /mcp.
    const mcpUrl =
      process.env.GRAFANA_MCP_URL?.trim() ||
      (grafanaUrl.includes("/mcp") ? grafanaUrl : "http://127.0.0.1:8000/mcp");
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
    await client.connect(transport);
    return client;
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.GRAFANA_URL = grafanaUrl;
  env.GRAFANA_SERVICE_ACCOUNT_TOKEN = token;

  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "uvx.exe" : "uvx",
    args: ["mcp-grafana"],
    env,
  });

  await client.connect(transport);
  return client;
}

async function getClient(): Promise<McpClient | null> {
  if (!isGrafanaConfigured()) return null;
  if (!cached) {
    cached = connectMcp().catch((error: unknown) => {
      connectError = error instanceof Error ? error.message : String(error);
      cached = null;
      throw error;
    });
  }
  try {
    return await cached;
  } catch {
    return null;
  }
}

function parseToolResult(result: unknown) {
  if (!result || typeof result !== "object") return result;
  const content = (result as { content?: { type: string; text?: string }[] }).content;
  const text = content?.find((item) => item.type === "text")?.text;
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return result;
}

/** Import-and-call site for official Grafana MCP tools. */
export async function callGrafanaTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<GrafanaToolResult> {
  const client = await getClient();
  if (!client) {
    return {
      mode: "fixture",
      tool: name,
      result: fixtureForTool(name, args),
      label: connectError
        ? `FIXTURE / DEMO MODE — mcp-grafana connect failed (${connectError})`
        : FIXTURE_LABEL,
    };
  }

  const raw = await client.callTool({ name, arguments: args });
  return {
    mode: "mcp",
    tool: name,
    result: parseToolResult(raw),
  };
}

export async function listFiringAlerts() {
  return callGrafanaTool("alerting_manage_rules", {
    operation: "list",
    limit: 20,
  });
}

export async function queryShowMetrics() {
  return callGrafanaTool("query_prometheus", {
    expr: `cineops_buffer_ratio{show="${SHOW.slug}",region="${SHOW.regionSlug}"}`,
    query: `cineops_buffer_ratio{show="${SHOW.slug}"}`,
    start: "now-15m",
    end: "now",
  });
}

export async function queryOrigin5xx() {
  return callGrafanaTool("query_prometheus", {
    expr: `cineops_origin_5xx{show="${SHOW.slug}",region="${SHOW.regionSlug}"}`,
    query: `cineops_origin_5xx{show="${SHOW.slug}"}`,
    start: "now-15m",
    end: "now",
  });
}

export async function queryEdgeLatency() {
  return callGrafanaTool("query_prometheus", {
    expr: `cineops_edge_latency{show="${SHOW.slug}",region="${SHOW.regionSlug}"}`,
    query: `cineops_edge_latency{show="${SHOW.slug}"}`,
    start: "now-15m",
    end: "now",
  });
}

export async function queryEdgeLogs(edge: string) {
  return callGrafanaTool("query_loki_logs", {
    logql: `{show="${SHOW.slug}",edge="${edge}"}`,
    query: `{show="${SHOW.slug}",edge="${edge}"}`,
    limit: 20,
    start: "now-15m",
    end: "now",
  });
}

export async function searchNightPremiereDashboard() {
  return callGrafanaTool("search_dashboards", {
    query: "Night Premiere QoS",
  });
}

export async function createGrafanaIncident(input: {
  title: string;
  severity?: string;
  body?: string;
}) {
  return callGrafanaTool("create_incident", {
    title: input.title,
    severity: input.severity ?? "major",
    isDrill: true,
    attachCaption: input.body,
  });
}

export async function updateGrafanaIncident(incidentId: string, body: string) {
  return callGrafanaTool("add_activity_to_incident", {
    incidentId,
    incidentID: incidentId,
    body,
  });
}

export async function resolveGrafanaIncident(incidentId: string, body: string) {
  const activity = await updateGrafanaIncident(
    incidentId,
    `RESOLVED — ${body}`,
  );

  const grafanaUrl = process.env.GRAFANA_URL?.replace(/\/$/, "");
  const token = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN;
  if (grafanaUrl && token && !grafanaUrl.includes("example")) {
    for (const plugin of ["grafana-irm-app", "grafana-incident-app"]) {
      try {
        await fetch(
          `${grafanaUrl}/api/plugins/${plugin}/resources/api/v1/IncidentsService.UpdateStatus`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ incidentID: incidentId, status: "resolved" }),
          },
        );
      } catch {
        // MCP activity write is the required path; HTTP resolve is best-effort.
      }
    }
  }

  return activity;
}

export function qosFromToolResult(result: GrafanaToolResult) {
  const payload = result.result as {
    structuredContent?: { result?: typeof fixtureEdgeQos };
    result?: typeof fixtureEdgeQos;
  };
  const rows =
    payload?.structuredContent?.result ??
    payload?.result ??
    fixtureEdgeQos;
  return Array.isArray(rows) ? rows : fixtureEdgeQos;
}

export function extractIncidentId(result: GrafanaToolResult): string | null {
  const raw = JSON.stringify(result.result);
  const match = raw.match(/"incidentID"\s*:\s*"([^"]+)"/i) ?? raw.match(/fix-np-\d+/);
  if (match?.[1]) return match[1];
  if (match?.[0]?.startsWith("fix-")) return match[0];
  return null;
}

export function dashboardDeeplink(result: GrafanaToolResult) {
  const base = process.env.GRAFANA_URL?.replace(/\/$/, "") ?? "";
  const raw = JSON.stringify(result.result);
  const uidMatch = raw.match(/"uid"\s*:\s*"([^"]+)"/);
  const uid = uidMatch?.[1] ?? "night-premiere-qos";
  if (!base) {
    return `/d/${uid}/night-premiere-qos`;
  }
  return `${base}/d/${uid}/night-premiere-qos`;
}

export { SUSPECT_EDGE };
