/**
 * FIXTURE / DEMO MODE — Grafana credentials are not configured.
 * These payloads mirror official mcp-grafana tools so Night Premiere still runs locally.
 * Real MCP call sites live in lib/grafana-mcp.ts.
 */
import { DRAIN_TARGETS, EDGES, SHOW, SUSPECT_EDGE } from "@/lib/show";

export const FIXTURE_LABEL =
  "FIXTURE / DEMO MODE — Grafana credentials not configured. Night Premiere QoS is simulated.";

export type EdgeQos = {
  edge: string;
  region: string;
  show: string;
  bufferRatio: number;
  origin5xx: number;
  edgeLatencyMs: number;
};

export const fixtureEdgeQos: EdgeQos[] = [
  {
    edge: "eu-west-edge-1",
    region: SHOW.regionSlug,
    show: SHOW.slug,
    bufferRatio: 0.11,
    origin5xx: 0.2,
    edgeLatencyMs: 48,
  },
  {
    edge: "eu-west-edge-2",
    region: SHOW.regionSlug,
    show: SHOW.slug,
    bufferRatio: 0.12,
    origin5xx: 0.1,
    edgeLatencyMs: 52,
  },
  {
    edge: SUSPECT_EDGE,
    region: SHOW.regionSlug,
    show: SHOW.slug,
    bufferRatio: 0.41,
    origin5xx: 12.4,
    edgeLatencyMs: 310,
  },
];

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export function fixtureForTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "alerting_manage_rules":
    case "list_alert_groups":
      return textResult({
        mode: "fixture",
        label: FIXTURE_LABEL,
        alerts: [
          {
            name: "NightPremiereBufferRatio",
            state: "firing",
            show: SHOW.slug,
            region: SHOW.regionSlug,
            summary: "Buffer ratio spike + origin 5xx on Night Premiere EU-West",
          },
        ],
      });
    case "query_prometheus":
      return textResult({
        mode: "fixture",
        label: FIXTURE_LABEL,
        query: args.expr ?? args.query,
        result: fixtureEdgeQos,
      });
    case "query_loki_logs":
      return textResult({
        mode: "fixture",
        label: FIXTURE_LABEL,
        logql: args.logql ?? args.query,
        logs: [
          `level=error edge=${SUSPECT_EDGE} show=${SHOW.slug} msg="origin 5xx burst from playback pack" status=502`,
          `level=warn edge=${SUSPECT_EDGE} show=${SHOW.slug} msg="buffer ratio 0.41 exceeds on-air threshold"`,
          `level=info edge=${DRAIN_TARGETS[0]} show=${SHOW.slug} msg="healthy, headroom available"`,
        ],
      });
    case "search_dashboards":
      return textResult({
        mode: "fixture",
        label: FIXTURE_LABEL,
        dashboards: [
          {
            title: "Night Premiere QoS",
            uid: "night-premiere-qos",
            url: "/d/night-premiere-qos/night-premiere-qos",
            tags: ["cineops", "premiere", "eu-west"],
          },
        ],
      });
    case "create_incident":
      return textResult({
        mode: "fixture",
        label: FIXTURE_LABEL,
        incident: {
          incidentID: `fix-np-${Date.now()}`,
          title: args.title ?? "Night Premiere QoS — EU-West",
          status: "active",
          severity: args.severity ?? "major",
        },
      });
    case "add_activity_to_incident":
      return textResult({
        mode: "fixture",
        label: FIXTURE_LABEL,
        ok: true,
        incidentId: args.incidentId ?? args.incidentID,
        body: args.body,
      });
    case "list_incidents":
    case "get_incident":
      return textResult({
        mode: "fixture",
        label: FIXTURE_LABEL,
        incidents: [
          {
            incidentID: "fix-np-active",
            title: "Night Premiere QoS — EU-West",
            status: "active",
          },
        ],
      });
    default:
      return textResult({
        mode: "fixture",
        label: FIXTURE_LABEL,
        tool: name,
        args,
        edges: EDGES,
      });
  }
}
