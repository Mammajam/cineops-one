/**
 * Google Gemini Interactions API client for CineOps One.
 *
 * Uses @google/genai with background: true so the Night Premiere diagnostic
 * loop is not killed by HTTP timeouts. Grafana MCP tools are declared as
 * function tools; the orchestrator executes them via lib/grafana-mcp.ts.
 */
import { GoogleGenAI } from "@google/genai";
import { SHOW, SUSPECT_EDGE } from "@/lib/show";

export const GEMINI_MODEL = "gemini-2.5-flash";

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function geminiMode(): "live" | "local-playbook" {
  return isGeminiConfigured() ? "live" : "local-playbook";
}

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

export const GRAFANA_FUNCTION_TOOLS = [
  {
    type: "function" as const,
    name: "alerting_manage_rules",
    description: "List Grafana alert rules / firing QoS alerts for the live show.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    type: "function" as const,
    name: "query_prometheus",
    description:
      "Query Prometheus via Grafana MCP for cineops_buffer_ratio, cineops_origin_5xx, cineops_edge_latency.",
    parameters: {
      type: "object",
      properties: {
        expr: { type: "string" },
        query: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
      },
    },
  },
  {
    type: "function" as const,
    name: "query_loki_logs",
    description: "Query Loki logs via Grafana MCP for a suspect edge.",
    parameters: {
      type: "object",
      properties: {
        logql: { type: "string" },
        query: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    type: "function" as const,
    name: "search_dashboards",
    description: "Search Grafana dashboards, especially Night Premiere QoS.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
    },
  },
  {
    type: "function" as const,
    name: "create_incident",
    description: "Create a Grafana Incident for the live-show QoS event.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        severity: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    type: "function" as const,
    name: "add_activity_to_incident",
    description: "Update a Grafana Incident with evidence, Interaction ID, or resolve notes.",
    parameters: {
      type: "object",
      properties: {
        incidentId: { type: "string" },
        body: { type: "string" },
      },
      required: ["incidentId", "body"],
    },
  },
];

export function diagnosisPrompt(input: {
  alertName: string;
  showName: string;
  region: string;
  interactionNote: string;
}) {
  return [
    `You are CineOps One, a studio-ops Gemini agent for live cinema broadcasts.`,
    `Show: ${input.showName}. Region: ${input.region}. Status: ON AIR.`,
    `Firing alert: ${input.alertName}.`,
    `Use Grafana MCP tools only: alerting_manage_rules, query_prometheus, query_loki_logs, search_dashboards, create_incident, add_activity_to_incident.`,
    `Identify the outlier edge. The bounded playbook only allows eu-west-edge-* . Prefer isolating ${SUSPECT_EDGE} if metrics agree.`,
    `Propose a SIMULATED drain to eu-west-edge-1/2. Do not patch live CDN routing.`,
    `Write findings with evidence and confidence. Include this note in the Grafana Incident: ${input.interactionNote}.`,
    `If confidence is low, say needs-human. Honor a kill switch — never fail over after cancel.`,
    `Return a short isolate verdict for the broadcast engineer.`,
  ].join("\n");
}

export type GeminiInteraction = {
  id: string;
  status: string;
  steps?: unknown;
  output?: unknown;
  outputs?: unknown;
  output_text?: string;
};

export async function startBackgroundDiagnosis(prompt: string): Promise<GeminiInteraction> {
  const ai = client();
  const interaction = await ai.interactions.create({
    model: GEMINI_MODEL,
    input: prompt,
    background: true,
    tools: GRAFANA_FUNCTION_TOOLS,
  });
  return mapInteraction(interaction);
}

export async function getBackgroundInteraction(id: string): Promise<GeminiInteraction> {
  const ai = client();
  const interaction = await ai.interactions.get(id);
  return mapInteraction(interaction);
}

export async function continueWithFunctionResults(input: {
  previousId: string;
  callId: string;
  name: string;
  result: unknown;
}): Promise<GeminiInteraction> {
  const ai = client();
  const interaction = await ai.interactions.create({
    model: GEMINI_MODEL,
    previous_interaction_id: input.previousId,
    background: true,
    tools: GRAFANA_FUNCTION_TOOLS,
    input: [
      {
        type: "function_result",
        name: input.name,
        call_id: input.callId,
        result: [
          {
            type: "text",
            text:
              typeof input.result === "string"
                ? input.result
                : JSON.stringify(input.result),
          },
        ],
      },
    ],
  });
  return mapInteraction(interaction);
}

export async function continueWithEvidence(previousId: string, evidence: string) {
  const ai = client();
  const interaction = await ai.interactions.create({
    model: GEMINI_MODEL,
    previous_interaction_id: previousId,
    background: true,
    input: `Grafana MCP evidence for ${SHOW.name}:\n${evidence}\nWrite the isolate verdict. Bounded to eu-west-edge-*.`,
  });
  return mapInteraction(interaction);
}

export async function cancelBackgroundInteraction(id: string) {
  if (!isGeminiConfigured() || id.startsWith("local-")) return { cancelled: true, local: true };
  const ai = client();
  await ai.interactions.cancel(id);
  return { cancelled: true, local: false };
}

function mapInteraction(interaction: {
  id: string;
  status?: string;
  steps?: unknown;
  output?: unknown;
  outputs?: unknown;
  output_text?: string;
}): GeminiInteraction {
  return {
    id: String(interaction.id),
    status: String(interaction.status ?? "in_progress"),
    steps: interaction.steps,
    output: interaction.output,
    outputs: interaction.outputs,
    output_text: interaction.output_text,
  };
}

export function extractFunctionCalls(interaction: GeminiInteraction) {
  const buckets = [interaction.steps, interaction.outputs, interaction.output];
  const calls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
  for (const bucket of buckets) {
    const items = Array.isArray(bucket) ? bucket : bucket ? [bucket] : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const row = item as {
        type?: string;
        name?: string;
        id?: string;
        call_id?: string;
        arguments?: Record<string, unknown>;
      };
      if (row.type === "function_call" && row.name) {
        calls.push({
          id: String(row.call_id ?? row.id ?? row.name),
          name: row.name,
          arguments: row.arguments ?? {},
        });
      }
    }
  }
  return calls;
}

export function extractOutputText(interaction: GeminiInteraction) {
  if (interaction.output_text) return interaction.output_text;
  const raw = JSON.stringify(interaction.output ?? interaction.outputs ?? "");
  const match = raw.match(/"text"\s*:\s*"([^"]{20,})"/);
  return match?.[1]?.replace(/\\n/g, "\n") ?? "";
}
