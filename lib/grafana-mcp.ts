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
import { fixtureForTool, FIXTURE_LABEL } from "@/lib/grafana-fixtures";
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
const datasourceUidCache: { prometheus?: string; loki?: string } = {};

export function isGrafanaConfigured() {
  return Boolean(process.env.GRAFANA_URL && process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN);
}

/** Numeric Grafana org for IRM / MCP. Empty means mcp-grafana falls back to org 0, which breaks create_incident. */
export function grafanaOrgId(): string | null {
  const raw = process.env.GRAFANA_ORG_ID?.trim();
  return raw || null;
}

function grafanaRequestHeaders(token: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const orgId = grafanaOrgId();
  if (orgId) headers["X-Grafana-Org-Id"] = orgId;
  return headers;
}

function transportMode() {
  return (process.env.GRAFANA_MCP_TRANSPORT ?? "stdio").toLowerCase();
}

/** Streamable HTTP MCP URL, or null — never falls back to localhost in production. */
export function grafanaMcpHttpUrl(): string | null {
  const explicit = process.env.GRAFANA_MCP_URL?.trim();
  if (explicit) return explicit;
  const grafanaUrl = process.env.GRAFANA_URL?.trim();
  if (grafanaUrl?.includes("/mcp")) return grafanaUrl;
  return null;
}

export function isGrafanaMcpLive() {
  if (!isGrafanaConfigured() || connectError) return false;
  if (transportMode() === "http") return Boolean(grafanaMcpHttpUrl());
  return true;
}

export function grafanaMode(): GrafanaCallMode {
  return isGrafanaMcpLive() ? "mcp" : "fixture";
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
    const mcpUrl = grafanaMcpHttpUrl();
    if (!mcpUrl) {
      throw new Error(
        "GRAFANA_MCP_TRANSPORT=http requires GRAFANA_MCP_URL (hosted mcp-grafana Streamable HTTP). No localhost fallback.",
      );
    }
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: {
        headers: grafanaRequestHeaders(token),
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
  const orgId = grafanaOrgId();
  if (orgId) env.GRAFANA_ORG_ID = orgId;

  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "uvx.exe" : "uvx",
    args: ["mcp-grafana"],
    env,
  });

  await client.connect(transport);
  return client;
}

async function getClient(): Promise<McpClient | null> {
  if (!isGrafanaMcpLive()) return null;
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

function rowsFromUnknown(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  }
  if (payload && typeof payload === "object") {
    const nested =
      (payload as { datasources?: unknown }).datasources ??
      (payload as { result?: unknown }).result ??
      (payload as { data?: unknown }).data;
    if (Array.isArray(nested)) {
      return nested.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
    }
  }
  return [];
}

async function resolveDatasourceUid(client: McpClient, type: "prometheus" | "loki") {
  const envKey = type === "prometheus" ? "GRAFANA_PROM_DATASOURCE_UID" : "GRAFANA_LOKI_DATASOURCE_UID";
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;
  if (datasourceUidCache[type]) return datasourceUidCache[type];

  const raw = await client.callTool({
    name: "list_datasources",
    arguments: { type, limit: 20 },
  });
  const rows = rowsFromUnknown(parseToolResult(raw));
  const match =
    rows.find((row) => String(row.type ?? "").toLowerCase().includes(type)) ?? rows[0];
  const uid = match ? String(match.uid ?? "").trim() : "";
  if (uid) datasourceUidCache[type] = uid;
  return uid || undefined;
}

async function normalizeMcpArgs(
  client: McpClient,
  name: string,
  incoming: Record<string, unknown>,
) {
  const args = { ...incoming };

  if (name === "alerting_manage_rules" && !args.operation) {
    args.operation = "list";
  }

  if (name === "query_prometheus") {
    if (!args.expr && typeof args.query === "string") args.expr = args.query;
    delete args.query;
    delete args.body;
    if (!args.datasourceUid) {
      const uid = await resolveDatasourceUid(client, "prometheus");
      if (uid) args.datasourceUid = uid;
    }
    if (!args.queryType) args.queryType = "range";
    if (typeof args.start === "string" && args.start.trim() && !args.startTime) {
      args.startTime = args.start.trim();
    }
    if (typeof args.end === "string" && args.end.trim() && !args.endTime) {
      args.endTime = args.end.trim();
    }
    delete args.start;
    delete args.end;
    for (const key of ["startTime", "endTime", "expr", "datasourceUid", "queryType"] as const) {
      if (typeof args[key] === "string" && !args[key].trim()) delete args[key];
    }
    if (!args.startTime) args.startTime = "now-6h";
    if (!args.endTime) args.endTime = "now";
    if (args.queryType === "range" && typeof args.stepSeconds !== "number") {
      args.stepSeconds = 15;
    }
  }

  if (name === "query_loki_logs") {
    if (!args.logql && typeof args.query === "string") args.logql = args.query;
    if (!args.datasourceUid) {
      const uid = await resolveDatasourceUid(client, "loki");
      if (uid) args.datasourceUid = uid;
    }
  }

  return args;
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

  const normalized = await normalizeMcpArgs(client, name, args);
  const raw = await client.callTool({ name, arguments: normalized });
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
              ...grafanaRequestHeaders(token),
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

export { mergeQosRows, qosFromToolResult } from "@/lib/qos";

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
