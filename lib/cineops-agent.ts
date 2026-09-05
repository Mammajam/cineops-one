/**
 * CineOps One diagnostic agent: @google/adk LlmAgent.
 *
 * Gemini chooses Grafana MCP tools (wrapped so traces stay in Neon) and
 * writes the isolate verdict via submit_isolate_verdict / mark_needs_human.
 * The playbook never picks the edge.
 */
import {
  createEvent,
  FunctionTool,
  Gemini,
  InMemorySessionService,
  LlmAgent,
  Runner,
  stringifyContent,
} from "@google/adk";
import type { Event } from "@google/adk";
import { z } from "zod";
import { callGrafanaTool, dashboardDeeplink, qosFromToolResult, type GrafanaToolResult } from "@/lib/grafana-mcp";
import { GEMINI_MODEL, isVertexConfigured } from "@/lib/gemini";
import { SHOW, EDGES } from "@/lib/show";
import { isolateVerdictSchema, type IsolateVerdict } from "@/lib/verdict";

export const APP_NAME = "cineops_one";
export const ADK_USER_ID = "night-premiere-crew";
export const MAX_ADK_TURNS = 12;

export type AdkSessionBlob = {
  appName: string;
  userId: string;
  sessionId: string;
  state: Record<string, unknown>;
  events: Record<string, unknown>[];
  turnCount: number;
  cancelled?: boolean;
};

export type AdkTurnResult = {
  blob: AdkSessionBlob;
  geminiText: string;
  verdict: IsolateVerdict | null;
  needsHuman: { reason: string } | null;
  qosRows: unknown[] | null;
  qosMode: "mcp" | "fixture" | null;
  dashboardUrl: string | null;
};

export type AdkTurnHooks = {
  onGrafanaTool: (
    name: string,
    args: Record<string, unknown>,
    result: GrafanaToolResult,
  ) => Promise<void>;
};

const GRAFANA_TOOL_NAMES = [
  "alerting_manage_rules",
  "query_prometheus",
  "query_loki_logs",
  "search_dashboards",
  "create_incident",
  "add_activity_to_incident",
] as const;

function asArgs(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function cineopsInstruction() {
  return [
    `You are CineOps One, a studio-ops Gemini agent for live cinema broadcasts.`,
    `Show: ${SHOW.name}. Region: ${SHOW.region}. Status: ON AIR.`,
    `Use Grafana MCP tools to diagnose the firing Night Premiere QoS alert: alerting_manage_rules, query_prometheus, query_loki_logs, search_dashboards.`,
    `Isolate the outlier edge in the live data. Allowed edges: ${EDGES.join(", ")}.`,
    `Do not prefer eu-west-edge-3. Do not assume which edge is failing. Read PromQL / Loki / alerts.`,
    `If tool results are mode=fixture, labeled FIXTURE, empty, or you are not confident, call mark_needs_human. Never invent a high-confidence isolate from demo data.`,
    `When the data shows a clear outlier, call submit_isolate_verdict with action simulate-drain. Simulated drain only — never patch live CDN routing.`,
    `Honor a kill switch: if the crew cancelled, call mark_needs_human and do not isolate.`,
    `create_incident / add_activity_to_incident are available; the playbook also opens a Grafana Incident after a gated verdict.`,
  ].join("\n");
}

function cineopsModel() {
  if (!process.env.GOOGLE_API_KEY && process.env.GEMINI_API_KEY) {
    process.env.GOOGLE_API_KEY = process.env.GEMINI_API_KEY;
  }
  const vertex = isVertexConfigured();
  return new Gemini({
    model: GEMINI_MODEL,
    vertexai: vertex,
    project: vertex ? process.env.GOOGLE_CLOUD_PROJECT : undefined,
    location: vertex ? process.env.GOOGLE_CLOUD_LOCATION : undefined,
    apiKey: vertex
      ? undefined
      : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY,
  });
}

export function createAdkSessionBlob(): AdkSessionBlob {
  return {
    appName: APP_NAME,
    userId: ADK_USER_ID,
    sessionId: crypto.randomUUID(),
    state: {},
    events: [],
    turnCount: 0,
  };
}

async function hydrateSession(blob: AdkSessionBlob) {
  const sessionService = new InMemorySessionService();
  await sessionService.createSession({
    appName: blob.appName,
    userId: blob.userId,
    sessionId: blob.sessionId,
    state: blob.state,
  });
  const session = await sessionService.getSession({
    appName: blob.appName,
    userId: blob.userId,
    sessionId: blob.sessionId,
  });
  if (!session) {
    throw new Error("ADK session hydrate failed");
  }
  for (const raw of blob.events) {
    await sessionService.appendEvent({
      session,
      event: createEvent(raw as Partial<Event>),
    });
  }
  return sessionService;
}

function serializeBlob(
  previous: AdkSessionBlob,
  session: { state: Record<string, unknown>; events: Event[] },
): AdkSessionBlob {
  return {
    appName: previous.appName,
    userId: previous.userId,
    sessionId: previous.sessionId,
    state: JSON.parse(JSON.stringify(session.state ?? {})) as Record<string, unknown>,
    events: JSON.parse(JSON.stringify(session.events ?? [])) as Record<string, unknown>[],
    turnCount: previous.turnCount + 1,
    cancelled: previous.cancelled,
  };
}

function grafanaFunctionTools(ctx: {
  hooks: AdkTurnHooks;
  qosRows: unknown[] | null;
  qosMode: "mcp" | "fixture" | null;
  dashboardUrl: string | null;
}) {
  return GRAFANA_TOOL_NAMES.map(
    (name) =>
      new FunctionTool({
        name,
        description:
          name === "alerting_manage_rules"
            ? "List Grafana alert rules / firing QoS alerts for the live show."
            : name === "query_prometheus"
              ? "Query Prometheus via Grafana MCP for cineops_buffer_ratio, cineops_origin_5xx, cineops_edge_latency."
              : name === "query_loki_logs"
                ? "Query Loki logs via Grafana MCP for a suspect edge."
                : name === "search_dashboards"
                  ? "Search Grafana dashboards, especially Night Premiere QoS."
                  : name === "create_incident"
                    ? "Create a Grafana Incident for the live-show QoS event."
                    : "Update a Grafana Incident with evidence or resolve notes.",
        parameters: z.object({
          operation: z.string().optional(),
          limit: z.number().optional(),
          expr: z.string().optional(),
          query: z.string().optional(),
          logql: z.string().optional(),
          start: z.string().optional(),
          end: z.string().optional(),
          title: z.string().optional(),
          severity: z.string().optional(),
          incidentId: z.string().optional(),
          incidentID: z.string().optional(),
          body: z.string().optional(),
        }),
        execute: async (input) => {
          const args = asArgs(input);
          const result = await callGrafanaTool(name, args);
          await ctx.hooks.onGrafanaTool(name, args, result);
          if (name === "query_prometheus") {
            const rows = qosFromToolResult(result);
            if (rows.length) ctx.qosRows = rows;
            ctx.qosMode = result.mode;
          }
          if (name === "search_dashboards") {
            ctx.dashboardUrl = dashboardDeeplink(result);
          }
          return {
            mode: result.mode,
            label: result.label ?? null,
            result: result.result,
          };
        },
      }),
  );
}

export async function runCineopsAdkTurn(input: {
  blob: AdkSessionBlob;
  userMessage: string;
  hooks: AdkTurnHooks;
}): Promise<AdkTurnResult> {
  const scratch = {
    hooks: input.hooks,
    qosRows: null as unknown[] | null,
    qosMode: null as "mcp" | "fixture" | null,
    dashboardUrl: null as string | null,
    verdict: null as IsolateVerdict | null,
    needsHuman: null as { reason: string } | null,
  };

  const submit = new FunctionTool({
    name: "submit_isolate_verdict",
    description:
      "Submit the isolate verdict after reading live Grafana MCP data. Simulated drain only. Do not call this for fixture-only evidence.",
    parameters: isolateVerdictSchema,
    execute: async (payload) => {
      scratch.verdict = payload as IsolateVerdict;
      return { ok: true, received: payload };
    },
  });

  const markHuman = new FunctionTool({
    name: "mark_needs_human",
    description:
      "Stop auto-isolate. Use when MCP is fixture-only, confidence is low, the edge is outside eu-west, or the kill switch fired.",
    parameters: z.object({
      reason: z.string().min(1),
    }),
    execute: async (payload) => {
      const reason = String((payload as { reason?: string }).reason ?? "Gemini requested human review");
      scratch.needsHuman = { reason };
      return { ok: true, reason };
    },
  });

  const agent = new LlmAgent({
    name: "cineops_one",
    model: cineopsModel(),
    instruction: cineopsInstruction(),
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
    tools: [...grafanaFunctionTools(scratch), submit, markHuman],
  });

  const sessionService = await hydrateSession(input.blob);
  const runner = new Runner({
    appName: input.blob.appName,
    agent,
    sessionService,
  });

  let geminiText = "";
  try {
    for await (const event of runner.runAsync({
      userId: input.blob.userId,
      sessionId: input.blob.sessionId,
      newMessage: { role: "user", parts: [{ text: input.userMessage }] },
      runConfig: { maxLlmCalls: 1 },
    })) {
      const text = stringifyContent(event);
      if (text.trim()) geminiText = text;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Max number of llm calls limit")) {
      throw error;
    }
  }

  const session = await sessionService.getSession({
    appName: input.blob.appName,
    userId: input.blob.userId,
    sessionId: input.blob.sessionId,
  });
  if (!session) {
    throw new Error("ADK session missing after turn");
  }

  return {
    blob: serializeBlob(input.blob, session),
    geminiText,
    verdict: scratch.verdict,
    needsHuman: scratch.needsHuman,
    qosRows: scratch.qosRows,
    qosMode: scratch.qosMode,
    dashboardUrl: scratch.dashboardUrl,
  };
}
